import type { DatabaseClient } from '../../db/database.js';
import { ValidationError } from '../../errors/domain-errors.js';
import type { TaskLifecycleServiceOperationContext } from './task-lifecycle-service-types.js';
import {
  buildMissingMilestoneBriefMessage,
  hasOperatorBriefForExecutionContext,
  readOperatorReportingContract,
  readInteger,
  readOptionalText,
  type LatestAssessmentRequestHandoffRow,
} from './task-lifecycle-service-helpers.js';

export async function assertOperatorReportingBeforeCompletion(
  context: TaskLifecycleServiceOperationContext,
  tenantId: string,
  task: Record<string, unknown>,
  client?: DatabaseClient,
): Promise<void> {
  const queryClient = client ?? await context.deps.pool.connect();
  const shouldReleaseClient = !client;
  const workflowId = readOptionalText(task.workflow_id);
  const taskId = readOptionalText(task.id);
  if (!workflowId || !taskId) {
    if (shouldReleaseClient) {
      queryClient.release();
    }
    return;
  }

  try {
    const contract = await readOperatorReportingContract(
      context.deps.pool,
      tenantId,
      task,
      queryClient,
    );
    if (!contract || !contract.milestoneBriefsRequired) {
      return;
    }

    const hasBrief = await hasOperatorBriefForExecutionContext(
      context.deps.pool,
      tenantId,
      workflowId,
      contract.executionContextId,
      queryClient,
    );
    if (hasBrief) {
      return;
    }

    throw new ValidationError(
      buildMissingMilestoneBriefMessage(contract),
      {
        reason_code: 'required_operator_milestone_brief',
        recoverable: true,
        recovery_hint: 'record_required_operator_brief',
        recovery: {
          status: 'action_required',
          reason: 'required_operator_milestone_brief',
          action: 'record_operator_brief',
          execution_context_id: contract.executionContextId,
          request_id_prefix: contract.operatorBriefRequestIdPrefix,
          source_kind: contract.sourceKind,
        },
      },
    );
  } finally {
    if (shouldReleaseClient) {
      queryClient.release();
    }
  }
}

export async function loadLatestAssessmentRequestHandoff(
  context: TaskLifecycleServiceOperationContext,
  tenantId: string,
  task: Record<string, unknown>,
  db?: DatabaseClient,
): Promise<LatestAssessmentRequestHandoffRow | null> {
  const taskId = readOptionalText(task.id);
  const workflowId = readOptionalText(task.workflow_id);
  const workItemId = readOptionalText(task.work_item_id);
  if (!taskId || !workflowId || !workItemId) {
    return null;
  }

  const queryClient = db
    ?? ('query' in context.deps.pool && typeof context.deps.pool.query === 'function'
      ? context.deps.pool
      : await context.deps.pool.connect());
  const ownsClient = db == null && queryClient !== context.deps.pool;

  try {
    const result = await queryClient.query<LatestAssessmentRequestHandoffRow>(
      `WITH RECURSIVE descendant_work_items AS (
          SELECT id
            FROM workflow_work_items
           WHERE tenant_id = $1
             AND workflow_id = $2
             AND id = $3
          UNION ALL
          SELECT child.id
            FROM workflow_work_items child
            JOIN descendant_work_items parent
              ON parent.id = child.parent_work_item_id
           WHERE child.tenant_id = $1
             AND child.workflow_id = $2
        )
        SELECT th.id AS handoff_id,
               th.task_id AS assessment_task_id,
               th.created_at
         FROM task_handoffs th
        WHERE th.tenant_id = $1
          AND th.workflow_id = $2
          AND th.resolution = 'request_changes'
          AND (
            COALESCE(th.role_data->>'subject_task_id', '') = $4
            OR COALESCE(th.role_data->>'subject_work_item_id', '') = $3::text
            OR EXISTS (
              SELECT 1
                FROM descendant_work_items review_wi
               WHERE review_wi.id <> $3
                 AND review_wi.id = th.work_item_id
            )
          )
        ORDER BY th.sequence DESC, th.created_at DESC
        LIMIT 1`,
      [tenantId, workflowId, workItemId, taskId],
    );
    return result.rows[0] ?? null;
  } finally {
    if (ownsClient && 'release' in queryClient && typeof queryClient.release === 'function') {
      queryClient.release();
    }
  }
}

export async function loadLatestTaskAttemptHandoffCreatedAt(
  context: TaskLifecycleServiceOperationContext,
  tenantId: string,
  task: Record<string, unknown>,
  db?: DatabaseClient,
): Promise<Date | null> {
  const taskId = readOptionalText(task.id);
  const taskReworkCount = readInteger(task.rework_count) ?? 0;
  if (!taskId) {
    return null;
  }

  const queryClient = db
    ?? ('query' in context.deps.pool && typeof context.deps.pool.query === 'function'
      ? context.deps.pool
      : await context.deps.pool.connect());
  const ownsClient = db == null && queryClient !== context.deps.pool;

  try {
    const result = await queryClient.query<{ created_at: Date | null }>(
      `SELECT created_at
         FROM task_handoffs
        WHERE tenant_id = $1
          AND task_id = $2
          AND task_rework_count = $3
        ORDER BY sequence DESC, created_at DESC
        LIMIT 1`,
      [tenantId, taskId, taskReworkCount],
    );
    return result.rows[0]?.created_at ?? null;
  } finally {
    if (ownsClient && 'release' in queryClient && typeof queryClient.release === 'function') {
      queryClient.release();
    }
  }
}
