import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { DatabaseQueryable } from '../../../db/database.js';
import {
  buildAssessmentSubjectInput,
  buildAssessmentSubjectMetadata,
  hasExplicitAssessmentSubjectLinkage,
  mergeAssessmentSubjectLinkage,
  readAssessmentSubjectLinkage,
  readWorkflowTaskKind,
} from '../../../services/assessment-subject-service.js';
import type { ActiveOrchestratorTaskScope } from '../../../services/task/task-agent-scope-service.js';

import {
  loadOrchestratorCreateWorkItemContext,
  type OrchestratorCreateWorkItemContext,
} from './activation-context.js';
import {
  asRecord,
  readInteger,
  readString,
} from './shared.js';
import { orchestratorTaskCreateSchema } from './schemas.js';
import { alignOrchestratorTaskCreateWorkItemToStage } from './stage-alignment.js';

interface ReviewedTaskContextRow {
  id: string;
  rework_count: number | null;
  input: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  is_orchestrator_task: boolean | null;
}

export async function normalizeOrchestratorTaskCreateInput(
  pool: FastifyInstance['pgPool'],
  tenantId: string,
  taskScope: ActiveOrchestratorTaskScope,
  body: z.infer<typeof orchestratorTaskCreateSchema>,
): Promise<z.infer<typeof orchestratorTaskCreateSchema>> {
  const topLevelNormalizedBody = hoistTopLevelAssessmentSubjectLinkage(body);
  const stageAlignedBody = await alignOrchestratorTaskCreateWorkItemToStage(
    pool,
    tenantId,
    taskScope.workflow_id,
    topLevelNormalizedBody,
  );
  const expectationTypedBody = await inferWorkItemExpectedTaskType(
    pool,
    tenantId,
    taskScope.workflow_id,
    stageAlignedBody,
  );
  const explicitLinkageBody = await normalizeExplicitAssessmentSubjectTaskLinkage(
    pool,
    tenantId,
    taskScope.workflow_id,
    expectationTypedBody,
  );
  if (hasExplicitReviewedTaskReference(explicitLinkageBody.input, explicitLinkageBody.metadata)) {
    return explicitLinkageBody;
  }

  const existingInput = explicitLinkageBody.input ?? {};
  const explicitAssessmentLinkage = readAssessmentSubjectLinkage(existingInput, explicitLinkageBody.metadata);
  const context = await loadOrchestratorCreateWorkItemContext(
    pool,
    tenantId,
    taskScope.workflow_id,
    taskScope.activation_id,
  );
  if (isReviewTaskCreate(explicitLinkageBody)) {
    const explicitTaskId = readString(existingInput.task_id);
    if (explicitTaskId) {
      const reviewTaskMetadata = await loadReviewedTaskMetadata(
        pool,
        tenantId,
        taskScope.workflow_id,
        explicitTaskId,
      );
      const resolvedLinkage = mergeAssessmentSubjectLinkage(reviewTaskMetadata, explicitAssessmentLinkage);
      return {
        ...explicitLinkageBody,
        input: buildAssessmentSubjectInput(existingInput, resolvedLinkage),
        metadata: buildAssessmentSubjectMetadata(
          explicitLinkageBody.metadata,
          resolvedLinkage,
          'input_task_id_default',
        ),
      };
    }

    const targetWorkItemSubject = await maybeLoadCrossStageTargetWorkItemAssessmentSubject(
      pool,
      tenantId,
      taskScope.workflow_id,
      explicitLinkageBody,
      context,
    );
    if (targetWorkItemSubject) {
      const resolvedLinkage = mergeAssessmentSubjectLinkage(targetWorkItemSubject, explicitAssessmentLinkage);
      return {
        ...explicitLinkageBody,
        input: buildAssessmentSubjectInput(explicitLinkageBody.input, resolvedLinkage),
        metadata: buildAssessmentSubjectMetadata(
          explicitLinkageBody.metadata,
          resolvedLinkage,
          'target_work_item_delivery_default',
        ),
      };
    }
    if (!isReviewLinkActivation(context.event_type)) {
      return body;
    }

    const reviewedTaskId = readString(context.payload.task_id);
    if (!reviewedTaskId) {
      return stageAlignedBody;
    }

    const reviewTaskMetadata = await loadReviewedTaskMetadata(
      pool,
      tenantId,
      taskScope.workflow_id,
      reviewedTaskId,
    );
    const resolvedLinkage = mergeAssessmentSubjectLinkage(reviewTaskMetadata, explicitAssessmentLinkage);

    return {
      ...explicitLinkageBody,
      input: buildAssessmentSubjectInput(explicitLinkageBody.input, resolvedLinkage),
      metadata: buildAssessmentSubjectMetadata(
        explicitLinkageBody.metadata,
        resolvedLinkage,
        'activation_default',
      ),
    };
  }

  if (!shouldDefaultActivationReviewedTaskLinkage(explicitLinkageBody, context.event_type)) {
    return explicitLinkageBody;
  }

  const reviewedTaskId = await loadActivationReviewedTaskId(
    pool,
    tenantId,
    taskScope.workflow_id,
    readString(context.payload.task_id),
  );
  if (!reviewedTaskId) {
    return stageAlignedBody;
  }

  const reviewedTaskMetadata = await loadReviewedTaskMetadata(
    pool,
    tenantId,
    taskScope.workflow_id,
    reviewedTaskId,
  );
  const resolvedLinkage = mergeAssessmentSubjectLinkage(reviewedTaskMetadata, explicitAssessmentLinkage);

  return {
    ...explicitLinkageBody,
    input: buildAssessmentSubjectInput(existingInput, resolvedLinkage),
    metadata: buildAssessmentSubjectMetadata(
      explicitLinkageBody.metadata,
      resolvedLinkage,
      'activation_lineage_default',
    ),
  };
}

async function inferWorkItemExpectedTaskType(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
  body: z.infer<typeof orchestratorTaskCreateSchema>,
): Promise<z.infer<typeof orchestratorTaskCreateSchema>> {
  if (body.type || !body.work_item_id || !body.role) {
    return body;
  }

  const result = await db.query<{
    next_expected_actor: string | null;
    next_expected_action: string | null;
  }>(
    `SELECT next_expected_actor, next_expected_action
       FROM workflow_work_items
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND id = $3
      LIMIT 1`,
    [tenantId, workflowId, body.work_item_id],
  );
  const row = result.rows[0];
  const expectedActor = readString(row?.next_expected_actor);
  const expectedAction = readString(row?.next_expected_action);
  if (!expectedActor || expectedActor !== body.role) {
    return body;
  }

  if (expectedAction === 'assess') {
    return { ...body, type: 'assessment' };
  }
  return body;
}

export async function normalizeExplicitAssessmentSubjectTaskLinkage(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
  body: z.infer<typeof orchestratorTaskCreateSchema>,
): Promise<z.infer<typeof orchestratorTaskCreateSchema>> {
  const explicitLinkage = readAssessmentSubjectLinkage(body.input ?? {}, body.metadata);
  if (!explicitLinkage.subjectTaskId || explicitLinkage.subjectRevision !== null) {
    return body;
  }

  const fallbackLinkage = await loadReviewedTaskMetadata(
    db,
    tenantId,
    workflowId,
    explicitLinkage.subjectTaskId,
  );
  const resolvedLinkage = mergeAssessmentSubjectLinkage(fallbackLinkage, explicitLinkage);
  return {
    ...body,
    input: buildAssessmentSubjectInput(body.input, resolvedLinkage),
    metadata: buildAssessmentSubjectMetadata(
      body.metadata,
      resolvedLinkage,
      'explicit_subject_task_default',
    ),
  };
}

function hoistTopLevelAssessmentSubjectLinkage(
  body: z.infer<typeof orchestratorTaskCreateSchema>,
): z.infer<typeof orchestratorTaskCreateSchema> {
  const {
    subject_task_id,
    subject_work_item_id,
    subject_handoff_id,
    subject_revision,
    ...rest
  } = body;
  const topLevelLinkage = readAssessmentSubjectLinkage({
    subject_task_id,
    subject_work_item_id,
    subject_handoff_id,
    subject_revision,
  });
  if (
    topLevelLinkage.subjectTaskId === null
    && topLevelLinkage.subjectWorkItemId === null
    && topLevelLinkage.subjectHandoffId === null
    && topLevelLinkage.subjectRevision === null
  ) {
    return rest;
  }
  return {
    ...rest,
    input: buildAssessmentSubjectInput(rest.input, topLevelLinkage),
    metadata: buildAssessmentSubjectMetadata(
      rest.metadata,
      topLevelLinkage,
      'top_level_create_task',
    ),
  };
}

async function loadReviewedTaskMetadata(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
  reviewedTaskId: string,
) {
  const result = await db.query<ReviewedTaskContextRow>(
    `SELECT id, rework_count, input, metadata, is_orchestrator_task
       FROM tasks
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND id = $3
      LIMIT 1`,
    [tenantId, workflowId, reviewedTaskId],
  );
  const row = result.rows[0];
  const taskKind = readWorkflowTaskKind(row?.metadata, Boolean(row?.is_orchestrator_task));
  if (taskKind === 'assessment' || taskKind === 'approval') {
    const explicitLinkage = readAssessmentSubjectLinkage(row?.input, row?.metadata);
    if (explicitLinkage.subjectTaskId) {
      return {
        subjectTaskId: explicitLinkage.subjectTaskId,
        subjectWorkItemId: explicitLinkage.subjectWorkItemId,
        subjectHandoffId: explicitLinkage.subjectHandoffId,
        subjectRevision: explicitLinkage.subjectRevision,
      };
    }
  }
  const deliverySubjectRevision = deriveReviewedDeliverySubjectRevision(row);
  return {
    subjectTaskId: row?.id ?? reviewedTaskId,
    subjectWorkItemId: null,
    subjectHandoffId: null,
    subjectRevision: deliverySubjectRevision,
  };
}

function deriveReviewedDeliverySubjectRevision(
  row: ReviewedTaskContextRow | undefined,
): number | null {
  const metadata = asRecord(row?.metadata);
  const input = asRecord(row?.input);
  const persistedRevision = readInteger(metadata.output_revision) ?? 0;
  const reworkDerivedRevision = (row?.rework_count ?? 0) + 1;
  const explicitRevision = readInteger(input.subject_revision) ?? 0;
  const subjectRevision = Math.max(persistedRevision, reworkDerivedRevision, explicitRevision);
  return subjectRevision > 0 ? subjectRevision : null;
}

async function maybeLoadCrossStageTargetWorkItemAssessmentSubject(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
  body: z.infer<typeof orchestratorTaskCreateSchema>,
  context: OrchestratorCreateWorkItemContext,
) {
  if (context.event_type !== 'task.handoff_submitted' || !body.work_item_id) {
    return null;
  }

  const result = await db.query<{
    subject_task_id: string | null;
    subject_work_item_id: string | null;
    subject_revision: number | null;
  }>(
    `SELECT th.role_data->>'subject_task_id' AS subject_task_id,
            NULLIF(th.role_data->>'subject_work_item_id', '') AS subject_work_item_id,
            NULLIF(COALESCE(NULLIF(th.role_data->>'subject_revision', '')::int, 0), 0) AS subject_revision
       FROM task_handoffs th
      WHERE th.tenant_id = $1
        AND th.workflow_id = $2
        AND th.work_item_id = $3
        AND th.completion = 'full'
        AND COALESCE(th.role_data->>'task_kind', 'delivery') = 'delivery'
      ORDER BY th.sequence DESC, th.created_at DESC
      LIMIT 1`,
    [tenantId, workflowId, body.work_item_id],
  );
  const row = result.rows[0];
  if (!row?.subject_task_id) {
    return null;
  }

  return {
    subjectTaskId: row.subject_task_id,
    subjectWorkItemId: row.subject_work_item_id ?? body.work_item_id,
    subjectHandoffId: null,
    subjectRevision: row.subject_revision ?? null,
  };
}

function shouldDefaultActivationReviewedTaskLinkage(
  body: z.infer<typeof orchestratorTaskCreateSchema>,
  eventType: string | null,
) {
  return readWorkflowTaskCreateKind(body) !== 'orchestrator' && isReviewLinkActivation(eventType);
}

function isReviewTaskCreate(body: z.infer<typeof orchestratorTaskCreateSchema>) {
  return readWorkflowTaskCreateKind(body) === 'assessment';
}

function isReviewLinkActivation(eventType: string | null) {
  return eventType === 'task.output_pending_assessment' || eventType === 'task.handoff_submitted';
}

function readWorkflowTaskCreateKind(body: z.infer<typeof orchestratorTaskCreateSchema>) {
  if (body.type === 'assessment') {
    return 'assessment';
  }
  return readWorkflowTaskKind(body.metadata);
}

async function loadActivationReviewedTaskId(
  pool: FastifyInstance['pgPool'],
  tenantId: string,
  workflowId: string,
  activationTaskId: string | null,
): Promise<string | null> {
  if (!activationTaskId) {
    return null;
  }

  const result = await pool.query<{ input: Record<string, unknown> | null }>(
    `SELECT input
       FROM tasks
      WHERE tenant_id = $1
        AND id = $2
        AND workflow_id = $3
      LIMIT 1`,
    [tenantId, activationTaskId, workflowId],
  );
  if (!result.rowCount) {
    return activationTaskId;
  }

  return readSubjectTaskReference(result.rows[0].input ?? undefined) ?? activationTaskId;
}

function hasExplicitReviewedTaskReference(
  input: Record<string, unknown> | undefined,
  metadata?: Record<string, unknown> | undefined,
) {
  return hasExplicitAssessmentSubjectLinkage(input, metadata);
}

function readSubjectTaskReference(input: Record<string, unknown> | undefined) {
  return readAssessmentSubjectLinkage(input).subjectTaskId;
}
