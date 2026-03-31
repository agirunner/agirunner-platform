import type { ApiKeyIdentity } from '../../auth/api-key.js';
import type { DatabaseClient } from '../../db/database.js';
import {
  activeColumnId,
  defaultColumnId,
  parsePlaybookDefinition,
} from '../../orchestration/playbook-model.js';
import { supersedeCurrentFinalDeliverablesForWorkItem } from '../workflow-deliverable-lifecycle-service.js';
import type { EventService } from '../event/event-service.js';
import {
  readOptionalText,
  resolveReopenColumnId,
  shouldReopenWorkItemForRework,
  type ReworkWorkItemContextRow,
  type WorkItemExecutionColumnContextRow,
  type WorkItemExecutionProgressRow,
} from './task-lifecycle-service-helpers.js';

export async function clearOpenChildAssessmentWorkItemRouting(
  tenantId: string,
  task: Record<string, unknown>,
  client: DatabaseClient,
): Promise<void> {
  const workflowId = readOptionalText(task.workflow_id);
  const workItemId = readOptionalText(task.work_item_id);
  if (!workflowId || !workItemId) {
    return;
  }

  await client.query(
    `UPDATE workflow_work_items wi
        SET next_expected_actor = NULL,
            next_expected_action = NULL,
            metadata = COALESCE(metadata, '{}'::jsonb) - 'orchestrator_finish_state',
            updated_at = now()
      WHERE wi.tenant_id = $1
        AND wi.workflow_id = $2
        AND wi.parent_work_item_id = $3
        AND wi.completed_at IS NULL
        AND EXISTS (
          SELECT 1
            FROM tasks assessment_task
           WHERE assessment_task.tenant_id = wi.tenant_id
             AND assessment_task.workflow_id = wi.workflow_id
             AND assessment_task.work_item_id = wi.id
             AND COALESCE(assessment_task.metadata->>'task_kind', '') = 'assessment'
        )`,
    [tenantId, workflowId, workItemId],
  );
}

export async function restoreOpenChildAssessmentWorkItemRouting(
  tenantId: string,
  task: Record<string, unknown>,
  client: DatabaseClient,
): Promise<void> {
  const workflowId = readOptionalText(task.workflow_id);
  const workItemId = readOptionalText(task.work_item_id);
  if (!workflowId || !workItemId) {
    return;
  }

  await client.query(
    `UPDATE workflow_work_items wi
        SET next_expected_actor = COALESCE(owner_role, next_expected_actor),
            next_expected_action = 'assess',
            metadata = COALESCE(metadata, '{}'::jsonb) - 'orchestrator_finish_state',
            updated_at = now()
      WHERE wi.tenant_id = $1
        AND wi.workflow_id = $2
        AND wi.parent_work_item_id = $3
        AND wi.completed_at IS NULL
        AND EXISTS (
          SELECT 1
            FROM tasks assessment_task
           WHERE assessment_task.tenant_id = wi.tenant_id
             AND assessment_task.workflow_id = wi.workflow_id
             AND assessment_task.work_item_id = wi.id
             AND COALESCE(assessment_task.metadata->>'task_kind', '') = 'assessment'
        )`,
    [tenantId, workflowId, workItemId],
  );
}

export async function reopenCompletedWorkItemForRework(input: {
  identity: ApiKeyIdentity;
  task: Record<string, unknown>;
  client: DatabaseClient;
  eventService: Pick<EventService, 'emit'>;
}): Promise<void> {
  const { identity, task, client, eventService } = input;
  const workflowId = readOptionalText(task.workflow_id);
  const workItemId = readOptionalText(task.work_item_id);
  if (!workflowId || !workItemId) {
    return;
  }

  const workItemResult = await client.query<ReworkWorkItemContextRow>(
    `SELECT wi.workflow_id,
            wi.id AS work_item_id,
            wi.stage_name,
            wi.column_id,
            wi.completed_at,
            w.state AS workflow_state,
            w.metadata AS workflow_metadata,
            p.definition
       FROM workflow_work_items wi
       JOIN workflows w
         ON w.tenant_id = wi.tenant_id
        AND w.id = wi.workflow_id
       JOIN playbooks p
         ON p.tenant_id = w.tenant_id
        AND p.id = w.playbook_id
      WHERE wi.tenant_id = $1
        AND wi.workflow_id = $2
        AND wi.id = $3
      LIMIT 1
      FOR UPDATE OF wi`,
    [identity.tenantId, workflowId, workItemId],
  );
  const workItem = workItemResult.rows[0];
  if (!workItem) {
    return;
  }

  const definition = parsePlaybookDefinition(workItem.definition);
  if (!shouldReopenWorkItemForRework(definition, workItem)) {
    return;
  }
  const reopenColumnId = resolveReopenColumnId({
    definition,
    currentColumnId: workItem.column_id,
    workflowState: workItem.workflow_state,
    workflowMetadata: workItem.workflow_metadata,
  });
  if (!reopenColumnId) {
    return;
  }

  const reopenedAt = new Date();
  const reopenResult = await client.query<{ id: string }>(
    `UPDATE workflow_work_items
        SET column_id = $4,
            completed_at = NULL,
            next_expected_actor = NULL,
            next_expected_action = NULL,
            metadata = COALESCE(metadata, '{}'::jsonb) - 'orchestrator_finish_state',
            updated_at = now()
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND id = $3
        AND (completed_at IS NOT NULL OR column_id = $5)
    RETURNING id`,
    [identity.tenantId, workflowId, workItemId, reopenColumnId, workItem.column_id],
  );
  if (!reopenResult.rowCount) {
    return;
  }

  await supersedeCurrentFinalDeliverablesForWorkItem(
    client,
    identity.tenantId,
    workflowId,
    workItemId,
  );

  const eventData = {
    workflow_id: workflowId,
    work_item_id: workItemId,
    stage_name: workItem.stage_name,
    previous_column_id: workItem.column_id,
    column_id: reopenColumnId,
    previous_completed_at: workItem.completed_at?.toISOString() ?? null,
    reopened_at: reopenedAt.toISOString(),
  };
  await eventService.emit(
    {
      tenantId: identity.tenantId,
      type: 'work_item.updated',
      entityType: 'work_item',
      entityId: workItemId,
      actorType: identity.scope,
      actorId: identity.keyPrefix,
      data: eventData,
    },
    client,
  );
  if (workItem.column_id !== reopenColumnId) {
    await eventService.emit(
      {
        tenantId: identity.tenantId,
        type: 'work_item.moved',
        entityType: 'work_item',
        entityId: workItemId,
        actorType: identity.scope,
        actorId: identity.keyPrefix,
        data: eventData,
      },
      client,
    );
  }
  await eventService.emit(
    {
      tenantId: identity.tenantId,
      type: 'work_item.reopened',
      entityType: 'work_item',
      entityId: workItemId,
      actorType: identity.scope,
      actorId: identity.keyPrefix,
      data: eventData,
    },
    client,
  );
}

export async function reconcileWorkItemExecutionColumn(input: {
  identity: ApiKeyIdentity;
  task: Record<string, unknown>;
  client: DatabaseClient;
  eventService: Pick<EventService, 'emit'>;
}): Promise<void> {
  const { identity, task, client, eventService } = input;
  const workflowId = readOptionalText(task.workflow_id);
  const workItemId = readOptionalText(task.work_item_id);
  if (!workflowId || !workItemId || task.is_orchestrator_task === true) {
    return;
  }

  const workItemResult = await client.query<WorkItemExecutionColumnContextRow>(
    `SELECT wi.workflow_id,
            wi.id AS work_item_id,
            wi.stage_name,
            wi.column_id,
            wi.completed_at,
            wi.blocked_state,
            wi.escalation_status,
            p.definition
       FROM workflow_work_items wi
       JOIN workflows w
         ON w.tenant_id = wi.tenant_id
        AND w.id = wi.workflow_id
       JOIN playbooks p
         ON p.tenant_id = w.tenant_id
        AND p.id = w.playbook_id
      WHERE wi.tenant_id = $1
        AND wi.workflow_id = $2
        AND wi.id = $3
      LIMIT 1
      FOR UPDATE OF wi`,
    [identity.tenantId, workflowId, workItemId],
  );
  const workItem = workItemResult.rows[0];
  if (
    !workItem
    || workItem.completed_at
    || workItem.blocked_state === 'blocked'
    || workItem.escalation_status === 'open'
  ) {
    return;
  }

  const definition = parsePlaybookDefinition(workItem.definition);
  const entryColumnId = defaultColumnId(definition);
  const executionColumnId = activeColumnId(definition);
  if (!entryColumnId || !executionColumnId) {
    return;
  }

  const executionProgress = await loadWorkItemExecutionProgress(
    client,
    identity.tenantId,
    workflowId,
    workItemId,
  );
  const nextColumnId = executionProgress.hasEngagedSpecialistTask
    ? executionColumnId
    : null;
  if (!nextColumnId || nextColumnId === workItem.column_id) {
    return;
  }

  const moveResult = await client.query<{ id: string }>(
    `UPDATE workflow_work_items
        SET column_id = $4,
            updated_at = now()
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND id = $3
        AND completed_at IS NULL
    RETURNING id`,
    [identity.tenantId, workflowId, workItemId, nextColumnId],
  );
  if (!moveResult.rowCount) {
    return;
  }

  const eventData = {
    workflow_id: workflowId,
    work_item_id: workItemId,
    stage_name: workItem.stage_name,
    previous_column_id: workItem.column_id,
    column_id: nextColumnId,
  };
  await eventService.emit(
    {
      tenantId: identity.tenantId,
      type: 'work_item.updated',
      entityType: 'work_item',
      entityId: workItemId,
      actorType: identity.scope,
      actorId: identity.keyPrefix,
      data: eventData,
    },
    client,
  );
  await eventService.emit(
    {
      tenantId: identity.tenantId,
      type: 'work_item.moved',
      entityType: 'work_item',
      entityId: workItemId,
      actorType: identity.scope,
      actorId: identity.keyPrefix,
      data: eventData,
    },
    client,
  );
}

export async function loadWorkItemExecutionProgress(
  client: DatabaseClient,
  tenantId: string,
  workflowId: string,
  workItemId: string,
) {
  const result = await client.query<WorkItemExecutionProgressRow>(
    `SELECT COUNT(*)::int AS engaged_task_count
       FROM tasks
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND work_item_id = $3
        AND is_orchestrator_task = FALSE
        AND state IN (
          'claimed',
          'in_progress',
          'awaiting_approval',
          'output_pending_assessment',
          'completed',
          'failed',
          'escalated'
        )`,
    [tenantId, workflowId, workItemId],
  );

  return {
    hasEngagedSpecialistTask: Number(result.rows[0]?.engaged_task_count ?? 0) > 0,
  };
}
