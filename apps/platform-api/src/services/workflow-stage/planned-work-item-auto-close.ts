import type { ApiKeyIdentity } from '../../auth/api-key.js';
import type { DatabaseClient } from '../../db/database.js';
import { parsePlaybookDefinition } from '../../orchestration/playbook-model.js';
import { EventService } from '../event/event-service.js';
import { reconcilePlannedWorkflowStages } from './workflow-stage-reconciliation.js';

interface PlannedWorkflowContextRow {
  lifecycle: string;
  definition: unknown;
}

interface WorkItemClosureCandidateRow {
  stage_name: string;
  column_id: string;
  completed_at: Date | null;
  gate_status: string;
  blocked_state: string | null;
  escalation_status: string | null;
  next_expected_actor: string | null;
  next_expected_action: string | null;
}

export async function maybeAutoCloseCompletedPlannedPredecessorWorkItem(
  eventService: EventService,
  identity: ApiKeyIdentity,
  workflowId: string,
  workItemId: string | null,
  client: DatabaseClient,
): Promise<boolean> {
  if (!workItemId) {
    return false;
  }

  const workflow = await loadWorkflowContext(identity.tenantId, workflowId, client);
  if (!workflow || workflow.lifecycle !== 'planned') {
    return false;
  }

  const definition = parsePlaybookDefinition(workflow.definition);
  const candidate = await loadClosureCandidate(identity.tenantId, workflowId, workItemId, client);
  if (!candidate || candidate.completed_at) {
    return false;
  }
  if (candidate.gate_status === 'awaiting_approval') {
    return false;
  }
  if (
    candidate.blocked_state === 'blocked'
    || candidate.escalation_status === 'open'
    || candidate.next_expected_actor
    || candidate.next_expected_action
  ) {
    return false;
  }

  const successorStageName = nextStageNameFor(definition, candidate.stage_name);
  if (successorStageName) {
    const successorExists = await hasImmediateSuccessor(
      identity.tenantId,
      workflowId,
      workItemId,
      successorStageName,
      client,
    );
    if (!successorExists) {
      return false;
    }
  }

  const openTaskCount = await countNonTerminalWorkItemTasks(
    identity.tenantId,
    workflowId,
    workItemId,
    client,
  );
  if (openTaskCount > 0) {
    return false;
  }
  if (await hasBlockingAssessmentResolution(identity.tenantId, workflowId, workItemId, client)) {
    return false;
  }

  const completionCallouts = await loadLatestFullWorkItemHandoffCompletionCallouts(
    identity.tenantId,
    workflowId,
    workItemId,
    client,
  );
  if (!completionCallouts) {
    return false;
  }

  const terminalColumnId = terminalColumnIdFor(definition) ?? candidate.column_id;
  const completedAt = new Date();
  const updateResult = await client.query<{ id: string }>(
    `UPDATE workflow_work_items
        SET column_id = $4,
            completed_at = COALESCE(completed_at, $5),
            completion_callouts = $6::jsonb,
            next_expected_actor = NULL,
            next_expected_action = NULL,
            metadata = COALESCE(metadata, '{}'::jsonb) - 'orchestrator_finish_state',
            updated_at = now()
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND id = $3
        AND completed_at IS NULL
    RETURNING id`,
    [identity.tenantId, workflowId, workItemId, terminalColumnId, completedAt, completionCallouts],
  );
  if (!updateResult.rowCount) {
    return false;
  }

  const eventData = {
    workflow_id: workflowId,
    work_item_id: workItemId,
    stage_name: candidate.stage_name,
    successor_stage_name: successorStageName,
    previous_column_id: candidate.column_id,
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
  if (terminalColumnId !== candidate.column_id) {
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

  await reconcilePlannedWorkflowStages(client, identity.tenantId, workflowId);
  return true;
}

async function loadWorkflowContext(
  tenantId: string,
  workflowId: string,
  client: DatabaseClient,
) {
  const result = await client.query<PlannedWorkflowContextRow>(
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

async function loadClosureCandidate(
  tenantId: string,
  workflowId: string,
  workItemId: string,
  client: DatabaseClient,
) {
  const result = await client.query<WorkItemClosureCandidateRow>(
    `SELECT wi.stage_name,
            wi.column_id,
            wi.completed_at,
            wi.blocked_state,
            wi.escalation_status,
            wi.next_expected_actor,
            wi.next_expected_action,
            ws.gate_status
       FROM workflow_work_items wi
       JOIN workflow_stages ws
         ON ws.tenant_id = wi.tenant_id
        AND ws.workflow_id = wi.workflow_id
        AND ws.name = wi.stage_name
      WHERE wi.tenant_id = $1
        AND wi.workflow_id = $2
        AND wi.id = $3
      FOR UPDATE OF wi`,
    [tenantId, workflowId, workItemId],
  );
  return result.rows[0] ?? null;
}

async function loadLatestFullWorkItemHandoffCompletionCallouts(
  tenantId: string,
  workflowId: string,
  workItemId: string,
  client: DatabaseClient,
) {
  const result = await client.query<{ completion_callouts: Record<string, unknown> | null }>(
    `SELECT th.completion_callouts
       FROM task_handoffs th
      WHERE th.tenant_id = $1
        AND th.workflow_id = $2
        AND th.work_item_id = $3
        AND th.completion = 'full'
      ORDER BY th.sequence DESC, th.created_at DESC
      LIMIT 1`,
    [tenantId, workflowId, workItemId],
  );
  return result.rows[0]?.completion_callouts ?? null;
}

async function hasBlockingAssessmentResolution(
  tenantId: string,
  workflowId: string,
  workItemId: string,
  client: DatabaseClient,
) {
  const result = await client.query<{ blocking_resolution: string | null }>(
    `SELECT latest_assessment.resolution AS blocking_resolution
       FROM LATERAL (
         SELECT th.task_id AS subject_task_id,
                NULLIF(COALESCE(NULLIF(th.role_data->>'subject_revision', '')::int, 0), 0) AS subject_revision
           FROM task_handoffs th
          WHERE th.tenant_id = $1
            AND th.workflow_id = $2
            AND th.work_item_id = $3
            AND th.completion = 'full'
            AND COALESCE(th.role_data->>'task_kind', 'delivery') = 'delivery'
          ORDER BY th.sequence DESC, th.created_at DESC
          LIMIT 1
       ) latest_delivery
       JOIN LATERAL (
         SELECT assessment_handoff.resolution
           FROM (
             SELECT DISTINCT ON (th.role)
                    th.role,
                    th.resolution
               FROM task_handoffs th
              WHERE th.tenant_id = $1
                AND th.workflow_id = $2
                AND th.work_item_id = $3
                AND COALESCE(th.role_data->>'task_kind', '') = 'assessment'
                AND COALESCE(th.role_data->>'subject_task_id', '') = COALESCE(latest_delivery.subject_task_id::text, '')
                AND COALESCE(NULLIF(th.role_data->>'subject_revision', '')::int, -1) = COALESCE(latest_delivery.subject_revision, -1)
                AND th.resolution IN ('approved', 'request_changes', 'rejected', 'blocked')
              ORDER BY th.role, th.sequence DESC, th.created_at DESC
           ) assessment_handoff
          WHERE assessment_handoff.resolution IN ('request_changes', 'rejected', 'blocked')
          LIMIT 1
       ) latest_assessment ON true`,
    [tenantId, workflowId, workItemId],
  );
  return Boolean(result.rows[0]?.blocking_resolution);
}

async function hasImmediateSuccessor(
  tenantId: string,
  workflowId: string,
  workItemId: string,
  successorStageName: string,
  client: DatabaseClient,
) {
  const result = await client.query<{ id: string }>(
    `SELECT id
       FROM workflow_work_items
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND parent_work_item_id = $3
        AND stage_name = $4
      LIMIT 1`,
    [tenantId, workflowId, workItemId, successorStageName],
  );
  return (result.rowCount ?? 0) > 0;
}

async function countNonTerminalWorkItemTasks(
  tenantId: string,
  workflowId: string,
  workItemId: string,
  client: DatabaseClient,
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

function nextStageNameFor(
  definition: ReturnType<typeof parsePlaybookDefinition>,
  currentStageName: string | null,
) {
  if (!currentStageName) {
    return null;
  }
  const currentIndex = definition.stages.findIndex((stage) => stage.name === currentStageName);
  if (currentIndex < 0) {
    return null;
  }
  return definition.stages[currentIndex + 1]?.name ?? null;
}

function terminalColumnIdFor(definition: ReturnType<typeof parsePlaybookDefinition>) {
  return definition.board.columns.find((column) => column.is_terminal)?.id ?? null;
}
