import { z } from 'zod';

import type { DatabaseQueryable } from '../../../db/database.js';
import {
  readAssessmentSubjectLinkage,
  readWorkflowTaskKind,
} from '../../../services/assessment-subject-service.js';
import { logSafetynetTriggered } from '../../../services/safetynet/logging.js';
import type { ActiveOrchestratorTaskScope } from '../../../services/task/task-agent-scope-service.js';

import type { OrchestratorCreateWorkItemContext } from './activation-context.js';
import {
  asRecord,
  buildRecoverableGuidedNoop,
  NOT_READY_NOOP_RECOVERY_SAFETYNET,
  readInteger,
  readString,
} from './shared.js';
import { orchestratorTaskCreateSchema } from './schemas.js';

interface ReviewedTaskReadinessRow {
  id: string;
  state: string | null;
  rework_count: number | null;
}

interface ExistingReviewTaskRow {
  id: string;
}

interface ExistingReworkTaskRow {
  id: string;
}

interface ActivationTaskReviewRequestStateRow {
  id: string;
  role: string | null;
  work_item_id: string | null;
  stage_name: string | null;
  metadata: Record<string, unknown> | null;
}

interface ReviewRequestTaskContextRow {
  id: string;
  work_item_id: string | null;
  stage_name: string | null;
}

export async function loadExistingReviewTaskForSameRevision(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
  body: z.infer<typeof orchestratorTaskCreateSchema>,
) {
  if (!isReviewTaskCreate(body) || !body.work_item_id) {
    return null;
  }

  const subjectTaskId = readSubjectTaskReference(body.input);
  const subjectRevision = readInteger(body.metadata?.subject_revision);
  if (!subjectTaskId || subjectRevision === null) {
    return null;
  }

  const result = await db.query<ExistingReviewTaskRow>(
    `SELECT id
       FROM tasks
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND work_item_id = $3
        AND role = $4
        AND state = ANY($5::task_state[])
        AND COALESCE(metadata->>'subject_task_id', '') = $6
        AND COALESCE((metadata->>'subject_revision')::integer, -1) = $7
      ORDER BY created_at DESC
      LIMIT 1`,
    [
      tenantId,
      workflowId,
      body.work_item_id,
      body.role,
      [
        'pending',
        'ready',
        'claimed',
        'in_progress',
        'awaiting_approval',
        'output_pending_assessment',
        'completed',
      ],
      subjectTaskId,
      subjectRevision,
    ],
  );
  return result.rows[0]?.id ?? null;
}

export async function buildRecoverableCreateTaskNoopIfNotReady(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
  taskScope: ActiveOrchestratorTaskScope,
  body: z.infer<typeof orchestratorTaskCreateSchema>,
): Promise<Record<string, unknown> | null> {
  if (!isVerificationTaskCreate(body)) {
    return null;
  }

  const subjectTaskId = readSubjectTaskReference(body.input);
  if (!subjectTaskId) {
    return null;
  }

  const result = await db.query<ReviewedTaskReadinessRow>(
    `SELECT id, state, rework_count
       FROM tasks
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND id = $3
      LIMIT 1`,
    [tenantId, workflowId, subjectTaskId],
  );
  const subjectTask = result.rows[0];
  if (!subjectTask || subjectTask.state === 'completed') {
    return null;
  }
  logSafetynetTriggered(
    NOT_READY_NOOP_RECOVERY_SAFETYNET,
    'recoverable create_task noop returned because subject task is not ready',
    { workflow_id: workflowId, subject_task_id: subjectTask.id ?? subjectTaskId },
  );

  return buildRecoverableGuidedNoop({
    reasonCode: 'subject_task_not_ready',
    safetynetBehaviorId: NOT_READY_NOOP_RECOVERY_SAFETYNET.id,
    stateSnapshot: {
      workflow_id: taskScope.workflow_id,
      work_item_id: body.work_item_id,
      task_id: taskScope.id,
      current_stage: body.stage_name,
      active_blocking_controls: [],
      active_advisory_controls: [],
    },
    suggestedNextActions: [
      {
        action_code: 'inspect_subject_task',
        target_type: 'task',
        target_id: subjectTask.id ?? subjectTaskId,
        why: 'The subject task has not produced a ready output yet.',
        requires_orchestrator_judgment: false,
      },
      {
        action_code: 'wait_for_subject_output',
        target_type: 'task',
        target_id: subjectTask.id ?? subjectTaskId,
        why: 'Dispatch the follow-up only after the current assessment or rework cycle resolves.',
        requires_orchestrator_judgment: false,
      },
    ],
    suggestedTargetIds: {
      workflow_id: taskScope.workflow_id,
      work_item_id: body.work_item_id,
      task_id: subjectTask.id ?? subjectTaskId,
    },
  });
}

export async function buildRecoverableCreateTaskNoopIfAssessmentRequestAlreadyApplied(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
  taskScope: ActiveOrchestratorTaskScope,
  context: OrchestratorCreateWorkItemContext,
  body: z.infer<typeof orchestratorTaskCreateSchema>,
): Promise<Record<string, unknown> | null> {
  if (context.event_type !== 'task.output_pending_assessment') {
    return null;
  }

  const activationTaskRole = readString(context.payload.task_role);
  if (!activationTaskRole || activationTaskRole !== body.role) {
    return null;
  }

  const activationTaskId = readString(context.payload.task_id);
  if (!activationTaskId) {
    return null;
  }

  const activationTaskResult = await db.query<ActivationTaskReviewRequestStateRow>(
    `SELECT id, role, work_item_id, stage_name, metadata
       FROM tasks
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND id = $3
      LIMIT 1`,
    [tenantId, workflowId, activationTaskId],
  );
  const activationTask = activationTaskResult.rows[0];
  if (!activationTask || !activationTask.role || activationTask.role !== body.role) {
    return null;
  }
  if (!activationTask.work_item_id || activationTask.work_item_id === body.work_item_id) {
    return null;
  }

  const assessmentRequestTaskId = readString(
    asRecord(activationTask.metadata).last_applied_assessment_request_task_id,
  );
  if (!assessmentRequestTaskId) {
    return null;
  }

  const assessmentRequestTaskResult = await db.query<ReviewRequestTaskContextRow>(
    `SELECT id, work_item_id, stage_name
       FROM tasks
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND id = $3
      LIMIT 1`,
    [tenantId, workflowId, assessmentRequestTaskId],
  );
  const assessmentRequestTask = assessmentRequestTaskResult.rows[0];
  if (!assessmentRequestTask?.work_item_id || assessmentRequestTask.work_item_id !== body.work_item_id) {
    return null;
  }
  logSafetynetTriggered(
    NOT_READY_NOOP_RECOVERY_SAFETYNET,
    'recoverable create_task noop returned because assessment request was already applied',
    { workflow_id: workflowId, work_item_id: body.work_item_id },
  );

  return buildRecoverableGuidedNoop({
    reasonCode: 'assessment_request_already_applied',
    safetynetBehaviorId: NOT_READY_NOOP_RECOVERY_SAFETYNET.id,
    stateSnapshot: {
      workflow_id: taskScope.workflow_id,
      work_item_id: body.work_item_id,
      task_id: taskScope.id,
      current_stage: body.stage_name,
      active_blocking_controls: [],
      active_advisory_controls: [],
    },
    suggestedNextActions: [
      {
        action_code: 'continue_routing_from_reopened_task',
        target_type: 'task',
        target_id: activationTask.id,
        why: 'The reopened task already owns the requested rework path.',
        requires_orchestrator_judgment: false,
      },
      {
        action_code: 'inspect_assessment_request',
        target_type: 'task',
        target_id: assessmentRequestTask.id,
        why: 'The prior assessment request already established the follow-up contract.',
        requires_orchestrator_judgment: false,
      },
    ],
    suggestedTargetIds: {
      workflow_id: taskScope.workflow_id,
      work_item_id: body.work_item_id,
      task_id: activationTask.id,
    },
  });
}

export async function loadExistingReworkTaskForAssessmentRequest(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
  context: OrchestratorCreateWorkItemContext,
  body: z.infer<typeof orchestratorTaskCreateSchema>,
) {
  if (context.event_type !== 'task.assessment_requested_changes') {
    return null;
  }

  const subjectTaskId = readString(context.payload.task_id);
  const subjectTaskRole = readString(context.payload.task_role);
  if (!subjectTaskId || !subjectTaskRole || body.role !== subjectTaskRole) {
    return null;
  }

  const result = await db.query<ExistingReworkTaskRow>(
    `SELECT id
       FROM tasks
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND id = $3
        AND role = $4
        AND state = ANY($5::task_state[])
      LIMIT 1`,
    [
      tenantId,
      workflowId,
      subjectTaskId,
      subjectTaskRole,
      ['pending', 'ready', 'claimed', 'in_progress', 'output_pending_assessment'],
    ],
  );
  return result.rows[0]?.id ?? null;
}

function isReviewTaskCreate(body: z.infer<typeof orchestratorTaskCreateSchema>) {
  return readWorkflowTaskCreateKind(body) === 'assessment';
}

function isVerificationTaskCreate(body: z.infer<typeof orchestratorTaskCreateSchema>) {
  return body.type === 'test';
}

function readWorkflowTaskCreateKind(body: z.infer<typeof orchestratorTaskCreateSchema>) {
  if (body.type === 'assessment') {
    return 'assessment';
  }
  return readWorkflowTaskKind(body.metadata);
}

function readSubjectTaskReference(input: Record<string, unknown> | undefined) {
  return readAssessmentSubjectLinkage(input).subjectTaskId;
}
