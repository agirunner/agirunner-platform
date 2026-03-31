import type { ApiKeyIdentity } from '../../auth/api-key.js';
import type { DatabaseClient } from '../../db/database.js';
import type { EventService } from '../event-service.js';
import { parsePlaybookDefinition } from '../../orchestration/playbook-model.js';
import { readWorkflowTaskKind } from '../assessment-subject-service.js';
import {
  asOptionalString,
  type OngoingWorkItemClosureCandidateRow,
  type OngoingWorkflowClosureContextRow,
} from './shared.js';
import { loadLatestTaskAttemptHandoffOutcome } from './assessment-resolution.js';

export async function maybeAutoCloseApprovedOngoingWorkItem(
  eventService: EventService,
  identity: ApiKeyIdentity,
  completedTask: Record<string, unknown>,
  client: DatabaseClient,
) {
  if (readWorkflowTaskKind(completedTask.metadata, Boolean(completedTask.is_orchestrator_task)) !== 'assessment') {
    return false;
  }

  const workflowId = asOptionalString(completedTask.workflow_id);
  const workItemId = asOptionalString(completedTask.work_item_id);
  if (!workflowId || !workItemId) {
    return false;
  }

  const latestHandoffOutcome = await loadLatestTaskAttemptHandoffOutcome(
    client,
    identity.tenantId,
    completedTask,
  );
  if (
    latestHandoffOutcome?.completion !== 'full'
    || latestHandoffOutcome.resolution !== 'approved'
  ) {
    return false;
  }

  const workflow = await loadOngoingWorkflowClosureContext(
    client,
    identity.tenantId,
    workflowId,
  );
  if (!workflow || workflow.lifecycle !== 'ongoing') {
    return false;
  }

  const workItem = await loadOngoingWorkItemClosureCandidate(
    client,
    identity.tenantId,
    workflowId,
    workItemId,
  );
  if (
    !workItem
    || workItem.completed_at
    || workItem.blocked_state === 'blocked'
    || workItem.escalation_status === 'open'
    || workItem.next_expected_actor
    || workItem.next_expected_action
  ) {
    return false;
  }

  const openTaskCount = await countNonTerminalWorkItemTasksForClosure(
    client,
    identity.tenantId,
    workflowId,
    workItemId,
  );
  if (openTaskCount > 0) {
    return false;
  }

  const terminalColumnId =
    parsePlaybookDefinition(workflow.definition).board.columns.find((column) => column.is_terminal)?.id
    ?? workItem.column_id;
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
    [identity.tenantId, workflowId, workItemId, terminalColumnId, completedAt],
  );
  if (!updateResult.rowCount) {
    return false;
  }

  const eventData = {
    workflow_id: workflowId,
    work_item_id: workItemId,
    stage_name: workItem.stage_name,
    previous_column_id: workItem.column_id,
    column_id: terminalColumnId,
    completed_at: completedAt.toISOString(),
  };
  await eventService.emit(
    {
      tenantId: identity.tenantId,
      type: 'work_item.updated',
      entityType: 'work_item',
      entityId: workItemId,
      actorType: 'system',
      actorId: 'task_completion_side_effects',
      data: eventData,
    },
    client,
  );
  if (terminalColumnId !== workItem.column_id) {
    await eventService.emit(
      {
        tenantId: identity.tenantId,
        type: 'work_item.moved',
        entityType: 'work_item',
        entityId: workItemId,
        actorType: 'system',
        actorId: 'task_completion_side_effects',
        data: eventData,
      },
      client,
    );
  }
  await eventService.emit(
    {
      tenantId: identity.tenantId,
      type: 'work_item.completed',
      entityType: 'work_item',
      entityId: workItemId,
      actorType: 'system',
      actorId: 'task_completion_side_effects',
      data: eventData,
    },
    client,
  );
  return true;
}

export async function loadOngoingWorkflowClosureContext(
  client: DatabaseClient,
  tenantId: string,
  workflowId: string,
) {
  const result = await client.query<OngoingWorkflowClosureContextRow>(
    `SELECT w.lifecycle, p.definition
       FROM workflows w
       JOIN playbooks p
         ON p.tenant_id = w.tenant_id
        AND p.id = w.playbook_id
      WHERE w.tenant_id = $1
        AND w.id = $2
      FOR UPDATE OF w`,
    [tenantId, workflowId],
  );
  return result.rows[0] ?? null;
}

export async function loadOngoingWorkItemClosureCandidate(
  client: DatabaseClient,
  tenantId: string,
  workflowId: string,
  workItemId: string,
) {
  const result = await client.query<OngoingWorkItemClosureCandidateRow>(
    `SELECT wi.stage_name,
            wi.column_id,
            wi.completed_at,
            wi.blocked_state,
            wi.escalation_status,
            wi.next_expected_actor,
            wi.next_expected_action
       FROM workflow_work_items wi
      WHERE wi.tenant_id = $1
        AND wi.workflow_id = $2
        AND wi.id = $3
      FOR UPDATE OF wi`,
    [tenantId, workflowId, workItemId],
  );
  return result.rows[0] ?? null;
}

export async function countNonTerminalWorkItemTasksForClosure(
  client: DatabaseClient,
  tenantId: string,
  workflowId: string,
  workItemId: string,
) {
  const result = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
       FROM tasks
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND work_item_id = $3
        AND state NOT IN ('completed', 'failed', 'cancelled')`,
    [tenantId, workflowId, workItemId],
  );
  return result.rows[0]?.count ?? 0;
}
