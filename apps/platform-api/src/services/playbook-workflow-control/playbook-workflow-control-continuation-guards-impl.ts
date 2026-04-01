
import type { DatabaseClient } from '../../db/database.js';
import { ValidationError } from '../../errors/domain-errors.js';
import type {
  BlockingStageWorkItemRow,
  BlockingTaskRow,
  WorkflowWorkItemRow,
} from './playbook-workflow-control-types.js';
import {
  COMPLETION_BLOCKING_NEXT_ACTIONS,
  TERMINAL_TASK_STATES,
} from './playbook-workflow-control-types.js';
import {
  describePendingContinuation,
  isAdvisoryContinuationAction,
} from './playbook-workflow-control-utils.js';

export async function completeOpenCheckpointWorkItemsImpl(this: any,
  tenantId: string,
  workflowId: string,
  checkpointName: string,
  terminalColumnId: string | null,
  db: DatabaseClient,
) {
  if (terminalColumnId) {
    await db.query(
      `UPDATE workflow_work_items
          SET column_id = $4,
              completed_at = COALESCE(completed_at, now()),
              next_expected_actor = NULL,
              next_expected_action = NULL,
              metadata = COALESCE(metadata, '{}'::jsonb) - 'orchestrator_finish_state',
              updated_at = now()
      WHERE tenant_id = $1
        AND workflow_id = $2
          AND stage_name = $3
          AND completed_at IS NULL`,
      [tenantId, workflowId, checkpointName, terminalColumnId],
    );
    return;
  }

  await db.query(
    `UPDATE workflow_work_items
        SET completed_at = COALESCE(completed_at, now()),
            next_expected_actor = NULL,
            next_expected_action = NULL,
            metadata = COALESCE(metadata, '{}'::jsonb) - 'orchestrator_finish_state',
            updated_at = now()
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND stage_name = $3
        AND completed_at IS NULL`,
    [tenantId, workflowId, checkpointName],
  );
}

export async function assertStageHasNoBlockingAssessmentResolutionImpl(this: any,
  tenantId: string,
  workflowId: string,
  stageName: string,
  db: DatabaseClient,
) {
  const result = await db.query<BlockingStageWorkItemRow>(
    `SELECT wi.id,
            wi.title,
            wi.blocked_state,
            wi.blocked_reason,
            COALESCE(blocking_assessment.blocking_resolution, latest_handoff.latest_handoff_resolution) AS blocking_resolution
       FROM workflow_work_items wi
       LEFT JOIN LATERAL (
         SELECT th.task_id AS subject_task_id,
                NULLIF(COALESCE(NULLIF(th.role_data->>'subject_revision', '')::int, 0), 0) AS subject_revision
           FROM task_handoffs th
          WHERE th.tenant_id = wi.tenant_id
            AND th.workflow_id = wi.workflow_id
            AND th.work_item_id = wi.id
            AND th.completion = 'full'
            AND COALESCE(th.role_data->>'task_kind', 'delivery') = 'delivery'
          ORDER BY th.sequence DESC, th.created_at DESC
          LIMIT 1
       ) latest_delivery ON true
       LEFT JOIN LATERAL (
         SELECT latest_assessment.resolution AS blocking_resolution
           FROM (
             SELECT DISTINCT ON (assessment_handoff.role)
                    assessment_handoff.role,
                    assessment_handoff.resolution
               FROM task_handoffs assessment_handoff
              WHERE assessment_handoff.tenant_id = wi.tenant_id
                AND assessment_handoff.workflow_id = wi.workflow_id
                AND COALESCE(assessment_handoff.role_data->>'task_kind', '') = 'assessment'
                AND COALESCE(assessment_handoff.role_data->>'subject_task_id', '') = COALESCE(latest_delivery.subject_task_id::text, '')
                AND COALESCE(NULLIF(assessment_handoff.role_data->>'subject_revision', '')::int, -1) = COALESCE(latest_delivery.subject_revision, -1)
                AND assessment_handoff.resolution IN ('request_changes', 'rejected')
              ORDER BY assessment_handoff.role, assessment_handoff.sequence DESC, assessment_handoff.created_at DESC
           ) latest_assessment
          LIMIT 1
       ) blocking_assessment ON true
       LEFT JOIN LATERAL (
         SELECT th.resolution AS latest_handoff_resolution
           FROM task_handoffs th
          WHERE th.tenant_id = wi.tenant_id
            AND th.workflow_id = wi.workflow_id
            AND th.work_item_id = wi.id
          ORDER BY th.sequence DESC, th.created_at DESC
          LIMIT 1
       ) latest_handoff ON true
      WHERE wi.tenant_id = $1
        AND wi.workflow_id = $2
        AND wi.stage_name = $3
        AND (
          wi.blocked_state = 'blocked'
          OR COALESCE(blocking_assessment.blocking_resolution, latest_handoff.latest_handoff_resolution) IN ('request_changes', 'rejected')
        )
      ORDER BY wi.created_at ASC
      LIMIT 1`,
    [tenantId, workflowId, stageName],
  );
  const row = result.rows[0];
  if (!row) {
    return;
  }
  if (row.blocked_state === 'blocked') {
    throw new ValidationError(
      `Cannot complete workflow while stage '${stageName}' still has blocked work item '${row.title}'.`,
      { reason_code: 'workflow_stage_blocked' },
    );
  }

  throw new ValidationError(
    `Cannot complete workflow while stage '${stageName}' still has a blocking ${row.blocking_resolution ?? 'assessment'} assessment on work item '${row.title}'.`,
    { reason_code: 'workflow_assessment_blocked' },
  );
}

export async function assertNoPendingBlockingContinuationImpl(this: any,
  tenantId: string,
  workflowId: string,
  workItem: Pick<
    WorkflowWorkItemRow,
    'title'
    | 'id'
    | 'next_expected_actor'
    | 'next_expected_action'
    | 'blocked_state'
    | 'blocked_reason'
    | 'escalation_status'
    | 'metadata'
  >,
  db: DatabaseClient,
  allowAdvisoryCarryForward = false,
) {
  if (workItem.blocked_state === 'blocked') {
    throw new ValidationError(
      `Cannot complete work item '${workItem.title}' while it is blocked${workItem.blocked_reason ? `: ${workItem.blocked_reason}` : '.'}`,
    );
  }
  if (workItem.escalation_status === 'open') {
    if (allowAdvisoryCarryForward) {
      return;
    }
    throw new ValidationError(
      `Cannot complete work item '${workItem.title}' while it still has an open escalation.`,
    );
  }
  if (!workItem.next_expected_actor || !workItem.next_expected_action) {
    return;
  }
  if (!COMPLETION_BLOCKING_NEXT_ACTIONS.has(workItem.next_expected_action)) {
    return;
  }
  if (
    workItem.next_expected_action === 'handoff'
    && await this.hasSatisfiedPendingHandoff(tenantId, workflowId, workItem, db)
  ) {
    return;
  }
  if (
    allowAdvisoryCarryForward
    && isAdvisoryContinuationAction(workItem.next_expected_action)
  ) {
    return;
  }

  const expectation = describePendingContinuation(workItem.next_expected_action);
  throw new ValidationError(
    `Cannot complete work item '${workItem.title}' while required ${expectation} by '${workItem.next_expected_actor}' is still pending.`,
    { reason_code: 'work_item_waiting_for_continuation' },
  );
}

export async function assertWorkItemHasNoActiveTasksImpl(this: any,
  tenantId: string,
  workflowId: string,
  workItemId: string,
  workItemTitle: string,
  actingTaskId: string | null,
  db: DatabaseClient,
) {
  const result = await db.query<BlockingTaskRow>(
    `SELECT id, role, state, stage_name
       FROM tasks
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND work_item_id = $3
        AND ($5::uuid IS NULL OR id <> $5::uuid)
        AND state::text <> ALL($4::text[])
      ORDER BY created_at ASC
      LIMIT 1`,
    [tenantId, workflowId, workItemId, TERMINAL_TASK_STATES, actingTaskId],
  );
  const row = result.rows[0];
  if (!row) {
    return;
  }
  throw new ValidationError(
    `Cannot complete work item '${workItemTitle}' while task '${row.role}' is still ${row.state}.`,
    { reason_code: 'work_item_tasks_not_ready' },
  );
}

export async function assertStageHasNoPendingBlockingContinuationImpl(this: any,
  tenantId: string,
  workflowId: string,
  stageName: string,
  db: DatabaseClient,
  allowAdvisoryCarryForward = false,
) {
  const result = await db.query<BlockingStageWorkItemRow>(
    `SELECT wi.id,
            wi.title,
            wi.blocked_state,
            wi.blocked_reason,
            wi.escalation_status,
            wi.next_expected_actor,
            wi.next_expected_action
       FROM workflow_work_items wi
      WHERE wi.tenant_id = $1
        AND wi.workflow_id = $2
        AND wi.stage_name = $3
        AND (
          wi.blocked_state = 'blocked'
          OR wi.escalation_status = 'open'
          OR (
            wi.next_expected_actor IS NOT NULL
            AND wi.next_expected_action = ANY($4::text[])
          )
        )
      ORDER BY wi.created_at ASC
      LIMIT 1`,
    [tenantId, workflowId, stageName, Array.from(COMPLETION_BLOCKING_NEXT_ACTIONS)],
  );
  const row = result.rows[0];
  if (row?.blocked_state === 'blocked') {
    throw new ValidationError(
      `Cannot complete workflow while stage '${stageName}' still has blocked work item '${row.title}'.`,
      { reason_code: 'workflow_stage_blocked' },
    );
  }
  if (row?.escalation_status === 'open') {
    if (allowAdvisoryCarryForward) {
      return;
    }
    throw new ValidationError(
      `Cannot complete workflow while stage '${stageName}' still has open escalation on work item '${row.title}'.`,
      { reason_code: 'workflow_stage_open_escalation' },
    );
  }
  if (!row?.next_expected_actor || !row.next_expected_action) {
    return;
  }
  if (allowAdvisoryCarryForward && isAdvisoryContinuationAction(row.next_expected_action)) {
    return;
  }

  const expectation = describePendingContinuation(row.next_expected_action);
  throw new ValidationError(
    `Cannot complete workflow while stage '${stageName}' still has required ${expectation} by '${row.next_expected_actor}' pending on work item '${row.title}'.`,
    { reason_code: 'workflow_continuation_pending' },
  );
}

export async function assertWorkflowHasNoActiveNonOrchestratorTasksImpl(this: any,
  tenantId: string,
  workflowId: string,
  db: DatabaseClient,
) {
  const result = await db.query<BlockingTaskRow>(
    `SELECT id, role, state, stage_name
       FROM tasks
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND is_orchestrator_task = false
        AND state::text <> ALL($3::text[])
      ORDER BY created_at ASC
      LIMIT 1`,
    [tenantId, workflowId, TERMINAL_TASK_STATES],
  );
  const row = result.rows[0];
  if (!row) {
    return;
  }
  const stageSuffix = row.stage_name ? ` in stage '${row.stage_name}'` : '';
  throw new ValidationError(
    `Cannot complete workflow while task '${row.role}'${stageSuffix} is still ${row.state}.`,
    { reason_code: 'workflow_tasks_not_ready' },
  );
}
