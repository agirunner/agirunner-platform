import type { ApiKeyIdentity } from '../../auth/api-key.js';
import { ValidationError } from '../../errors/domain-errors.js';
import { parsePlaybookDefinition } from '../../orchestration/playbook-model.js';
import type { DatabaseClient } from '../../db/database.js';
import type { WorkItemServiceDependencies } from './types.js';
import {
  actorTypeForIdentity,
  describePendingContinuation,
  nextStageNameFor,
  shouldAutoClosePredecessorCheckpoint,
  shouldBlockSuccessorCheckpointForOpenTasks,
  terminalColumnIdFor,
} from './shared.js';
import type {
  CheckpointPredecessorRow,
  NonTerminalTaskStateCountRow,
} from './types.js';

const SUCCESSOR_BLOCKING_NEXT_ACTIONS = new Set(['assess', 'approve', 'rework', 'handoff']);

export async function assertSuccessorCheckpointReady(
  tenantId: string,
  workflowId: string,
  definition: ReturnType<typeof parsePlaybookDefinition>,
  successorStageName: string,
  parentWorkItemId: string | null,
  client: DatabaseClient,
) {
  if (!parentWorkItemId) {
    return;
  }

  const predecessor = await loadCheckpointPredecessor(tenantId, workflowId, parentWorkItemId, client);
  if (!predecessor || predecessor.completed_at) {
    return;
  }

  if (predecessor.stage_name === successorStageName) {
    return;
  }

  const expectedSuccessorStageName = nextStageNameFor(definition, predecessor.stage_name);
  if (!expectedSuccessorStageName || successorStageName !== expectedSuccessorStageName) {
    throw new ValidationError(
      `Cannot create successor work item in stage '${successorStageName}' from predecessor ` +
        `'${predecessor.title}' (${predecessor.stage_name}). Expected the next planned stage ` +
        `'${expectedSuccessorStageName ?? 'none'}'.`,
    );
  }

  if (predecessor.gate_status === 'awaiting_approval') {
    throw new ValidationError(
      `Cannot create successor work item in stage '${successorStageName}' while predecessor ` +
        `'${predecessor.title}' (${predecessor.stage_name}) still awaits gate approval.`,
      {
        recovery_hint: 'wait_for_workflow_event',
        reason_code: 'predecessor_waiting_for_gate',
      },
    );
  }
  if (predecessor.blocked_state === 'blocked') {
    throw new ValidationError(
      `Cannot create successor work item in stage '${successorStageName}' while predecessor ` +
        `'${predecessor.title}' (${predecessor.stage_name}) is blocked${predecessor.blocked_reason ? `: ${predecessor.blocked_reason}` : '.'}`,
    );
  }
  if (predecessor.escalation_status === 'open') {
    throw new ValidationError(
      `Cannot create successor work item in stage '${successorStageName}' while predecessor ` +
        `'${predecessor.title}' (${predecessor.stage_name}) still has an open escalation.`,
    );
  }

  const predecessorReadyByApprovedGate = predecessor.gate_status === 'approved';
  if (!predecessorReadyByApprovedGate && predecessor.latest_handoff_completion !== 'full') {
    throw new ValidationError(
      `Cannot create successor work item in stage '${successorStageName}' before predecessor ` +
        `'${predecessor.title}' (${predecessor.stage_name}) has a full handoff. ` +
        `Wait for the current stage specialist to complete and submit the handoff first.`,
      {
        recovery_hint: 'wait_for_workflow_event',
        reason_code: 'predecessor_waiting_for_handoff',
      },
    );
  }
  if (
    !predecessorReadyByApprovedGate
    && (
      predecessor.latest_handoff_resolution === 'request_changes'
      || predecessor.latest_handoff_resolution === 'rejected'
    )
  ) {
    throw new ValidationError(
      `Cannot create successor work item in stage '${successorStageName}' while predecessor ` +
        `'${predecessor.title}' (${predecessor.stage_name}) still requires follow-up after a resolution of ` +
        `'${predecessor.latest_handoff_resolution}'.`,
    );
  }
  if (
    predecessor.next_expected_actor
    && predecessor.next_expected_action
    && !(predecessorReadyByApprovedGate && predecessor.next_expected_action === 'approve')
    && SUCCESSOR_BLOCKING_NEXT_ACTIONS.has(predecessor.next_expected_action)
  ) {
    throw new ValidationError(
      `Cannot create successor work item in stage '${successorStageName}' while predecessor ` +
        `'${predecessor.title}' (${predecessor.stage_name}) still requires ` +
        `${describePendingContinuation(predecessor.next_expected_action)} by ` +
        `'${predecessor.next_expected_actor}'.`,
    );
  }

  const nonTerminalTaskStates = await loadNonTerminalWorkItemTaskStateCounts(
    tenantId,
    workflowId,
    parentWorkItemId,
    client,
  );
  if (shouldBlockSuccessorCheckpointForOpenTasks(definition, predecessor.stage_name, nonTerminalTaskStates)) {
    throw new ValidationError(
      `Cannot create successor work item in stage '${successorStageName}' while predecessor ` +
        `'${predecessor.title}' (${predecessor.stage_name}) still has non-terminal tasks. ` +
        `Wait for the current stage work item to finish before routing to the next stage.`,
      {
        recovery_hint: 'wait_for_workflow_event',
        reason_code: 'predecessor_not_ready',
      },
    );
  }
}

export async function closeSupersededPredecessorWorkItem(
  deps: WorkItemServiceDependencies,
  identity: ApiKeyIdentity,
  workflowId: string,
  definition: ReturnType<typeof parsePlaybookDefinition>,
  successorStageName: string,
  successorWorkItemId: string,
  parentWorkItemId: string | null,
  client: DatabaseClient,
) {
  if (!parentWorkItemId) {
    return;
  }

  const predecessor = await loadCheckpointPredecessor(
    identity.tenantId,
    workflowId,
    parentWorkItemId,
    client,
  );
  if (!predecessor || predecessor.completed_at) {
    return;
  }

  const predecessorStageName = predecessor.stage_name;
  if (!shouldAutoClosePredecessorCheckpoint(definition, predecessorStageName, successorStageName)) {
    return;
  }
  if (predecessor.gate_status === 'awaiting_approval') {
    return;
  }

  if (
    (await countNonTerminalWorkItemTasks(
      identity.tenantId,
      workflowId,
      parentWorkItemId,
      client,
    )) > 0
  ) {
    return;
  }

  const terminalColumnId = terminalColumnIdFor(definition) ?? predecessor.column_id;
  const completedAt = new Date();
  const updateResult = await client.query<{ id: string }>(
    `UPDATE workflow_work_items
        SET column_id = $4,
            completed_at = COALESCE(completed_at, $5),
            next_expected_actor = NULL,
            next_expected_action = NULL,
            metadata = COALESCE(metadata, '{}'::jsonb) - 'orchestrator_finish_state',
            updated_at = now()
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND id = $3
        AND completed_at IS NULL
    RETURNING id`,
    [identity.tenantId, workflowId, parentWorkItemId, terminalColumnId, completedAt],
  );
  if (!updateResult.rowCount) {
    return;
  }

  const baseData = {
    workflow_id: workflowId,
    work_item_id: parentWorkItemId,
    stage_name: predecessor.stage_name,
    successor_work_item_id: successorWorkItemId,
    successor_stage_name: successorStageName,
    previous_column_id: predecessor.column_id,
    column_id: terminalColumnId,
    completed_at: completedAt.toISOString(),
  };
  await deps.eventService.emit(
    {
      tenantId: identity.tenantId,
      type: 'work_item.updated',
      entityType: 'work_item',
      entityId: parentWorkItemId,
      actorType: actorTypeForIdentity(identity),
      actorId: identity.keyPrefix,
      data: baseData,
    },
    client,
  );
  if (terminalColumnId !== predecessor.column_id) {
    await deps.eventService.emit(
      {
        tenantId: identity.tenantId,
        type: 'work_item.moved',
        entityType: 'work_item',
        entityId: parentWorkItemId,
        actorType: actorTypeForIdentity(identity),
        actorId: identity.keyPrefix,
        data: baseData,
      },
      client,
    );
  }
  await deps.eventService.emit(
    {
      tenantId: identity.tenantId,
      type: 'work_item.completed',
      entityType: 'work_item',
      entityId: parentWorkItemId,
      actorType: actorTypeForIdentity(identity),
      actorId: identity.keyPrefix,
      data: baseData,
    },
    client,
  );
}

async function loadCheckpointPredecessor(
  tenantId: string,
  workflowId: string,
  parentWorkItemId: string,
  client: DatabaseClient,
) {
  const predecessorResult = await client.query<CheckpointPredecessorRow>(
    `SELECT wi.id,
            wi.title,
            wi.stage_name,
            wi.column_id,
            wi.completed_at,
            wi.next_expected_actor,
            wi.next_expected_action,
            wi.blocked_state,
            wi.blocked_reason,
            wi.escalation_status,
            COALESCE(ws.gate_status, 'not_requested') AS gate_status,
            latest_handoff.latest_handoff_completion,
            latest_handoff.latest_handoff_resolution
       FROM workflow_work_items wi
       LEFT JOIN workflow_stages ws
         ON ws.tenant_id = wi.tenant_id
        AND ws.workflow_id = wi.workflow_id
        AND ws.name = wi.stage_name
       LEFT JOIN LATERAL (
         SELECT th.completion AS latest_handoff_completion,
                th.resolution AS latest_handoff_resolution
           FROM task_handoffs th
          WHERE th.tenant_id = wi.tenant_id
            AND th.workflow_id = wi.workflow_id
            AND th.work_item_id = wi.id
          ORDER BY th.sequence DESC, th.created_at DESC
          LIMIT 1
       ) latest_handoff ON true
      WHERE wi.tenant_id = $1
        AND wi.workflow_id = $2
        AND wi.id = $3
      LIMIT 1
      FOR UPDATE OF wi`,
    [tenantId, workflowId, parentWorkItemId],
  );
  return predecessorResult.rows[0] ?? null;
}

async function countNonTerminalWorkItemTasks(
  tenantId: string,
  workflowId: string,
  workItemId: string,
  client: DatabaseClient,
) {
  const taskResult = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
       FROM tasks
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND work_item_id = $3
        AND COALESCE(is_orchestrator_task, FALSE) = FALSE
        AND state NOT IN ('completed', 'failed', 'cancelled')`,
    [tenantId, workflowId, workItemId],
  );
  return taskResult.rows[0]?.count ?? 0;
}

async function loadNonTerminalWorkItemTaskStateCounts(
  tenantId: string,
  workflowId: string,
  workItemId: string,
  client: DatabaseClient,
) {
  const taskResult = await client.query<NonTerminalTaskStateCountRow>(
    `SELECT state, COUNT(*)::int AS count
       FROM tasks
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND work_item_id = $3
        AND COALESCE(is_orchestrator_task, FALSE) = FALSE
        AND state NOT IN ('completed', 'failed', 'cancelled')
      GROUP BY state`,
    [tenantId, workflowId, workItemId],
  );
  return taskResult.rows.reduce((counts, row) => {
    counts.set(row.state, row.count);
    return counts;
  }, new Map<string, number>());
}
