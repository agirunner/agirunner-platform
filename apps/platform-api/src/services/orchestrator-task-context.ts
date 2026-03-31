import type { DatabaseQueryable } from '../db/database.js';
import { parsePlaybookDefinition } from '../orchestration/playbook-model.js';
import {
  queryWorkflowStageViews,
} from './workflow-stage/workflow-stage-service.js';
import {
  deriveWorkflowStageProjection,
} from './workflow-stage/workflow-stage-projection.js';
import {
  activeStageNames,
  derivePendingDispatches,
  loadPlaybookRoleDefinitions,
  selectClosureContextFocus,
  serializeActivationBatch,
  serializeDates,
  serializeWorkItem,
  asRecord,
  type ActivationRow,
  type EscalationRow,
  type StageGateRow,
  type ToolResultRow,
  type WorkflowRow,
} from './orchestrator-task-context/helpers.js';
import { buildClosureContext } from './orchestrator-task-context/closure-context.js';

export async function buildOrchestratorTaskContext(
  db: DatabaseQueryable,
  tenantId: string,
  task: Record<string, unknown>,
) {
  if (!task.is_orchestrator_task || !task.workflow_id) {
    return null;
  }

  const workflowId = String(task.workflow_id);
  const taskMetadata = asRecord(task.metadata);
  const activationId =
    typeof task.activation_id === 'string' && task.activation_id.trim().length > 0
      ? task.activation_id
      : null;

  const [workflowRes, activationRes, workItemsRes, stagesRes, tasksRes, queuedActivationsRes, stageGatesRes, escalationsRes, toolResultsRes] =
    await Promise.all([
      db.query<WorkflowRow>(
        `SELECT w.id,
                w.name,
                w.lifecycle,
                w.metadata,
                p.name AS playbook_name,
                p.outcome AS playbook_outcome,
                p.definition AS playbook_definition
           FROM workflows w
           JOIN playbooks p
             ON p.tenant_id = w.tenant_id
            AND p.id = w.playbook_id
          WHERE w.tenant_id = $1
            AND w.id = $2`,
        [tenantId, workflowId],
      ),
      activationId
        ? db.query<ActivationRow>(
            `SELECT id, activation_id, reason, event_type, payload, state, queued_at, started_at,
                    dispatch_attempt, dispatch_token, consumed_at, completed_at, summary, error
               FROM workflow_activations
              WHERE tenant_id = $1
                AND (id = $2 OR activation_id = $2)
              ORDER BY queued_at ASC`,
            [tenantId, activationId],
          )
        : Promise.resolve({ rows: [] }),
      db.query<Record<string, unknown>>(
        `SELECT id,
                parent_work_item_id,
                stage_name,
                title,
                goal,
                column_id,
                owner_role,
                next_expected_actor,
                next_expected_action,
                rework_count,
                priority,
                completed_at,
                notes,
                metadata,
                latest_delivery.subject_role AS current_subject_role,
                latest_delivery.subject_revision AS current_subject_revision
           FROM workflow_work_items
           LEFT JOIN LATERAL (
             SELECT th.role AS subject_role,
                    NULLIF(COALESCE(NULLIF(th.role_data->>'subject_revision', '')::int, 0), 0) AS subject_revision
               FROM task_handoffs th
              WHERE th.tenant_id = workflow_work_items.tenant_id
                AND th.workflow_id = workflow_work_items.workflow_id
                AND th.work_item_id = workflow_work_items.id
                AND COALESCE(th.role_data->>'task_kind', 'delivery') = 'delivery'
                AND th.completion = 'full'
              ORDER BY th.sequence DESC, th.created_at DESC
              LIMIT 1
           ) latest_delivery ON true
          WHERE tenant_id = $1
            AND workflow_id = $2
          ORDER BY created_at ASC`,
        [tenantId, workflowId],
      ),
      queryWorkflowStageViews(db, tenantId, workflowId),
      db.query<Record<string, unknown>>(
        `SELECT id,
                title,
                role,
                state,
                work_item_id,
                stage_name,
                activation_id,
                assigned_agent_id,
                claimed_at,
                started_at,
                completed_at,
                retry_count,
                rework_count,
                error,
                is_orchestrator_task,
                input,
                metadata
           FROM tasks
          WHERE tenant_id = $1
            AND workflow_id = $2
          ORDER BY created_at DESC
          LIMIT 100`,
        [tenantId, workflowId],
      ),
      db.query<Record<string, unknown>>(
        `SELECT id, activation_id, reason, event_type, payload, state, queued_at, started_at,
                dispatch_attempt, dispatch_token, consumed_at, completed_at, summary, error
           FROM workflow_activations
          WHERE tenant_id = $1
            AND workflow_id = $2
            AND consumed_at IS NULL
            AND activation_id IS NULL
            AND state = 'queued'
          ORDER BY queued_at ASC
          LIMIT 20`,
        [tenantId, workflowId],
      ),
      db.query<StageGateRow>(
        `SELECT id,
                stage_name,
                status,
                closure_effect,
                requested_by_work_item_id,
                request_summary
           FROM workflow_stage_gates
          WHERE tenant_id = $1
            AND workflow_id = $2
          ORDER BY requested_at DESC
          LIMIT 20`,
        [tenantId, workflowId],
      ),
      db.query<EscalationRow>(
        `SELECT id,
                work_item_id,
                reason,
                closure_effect,
                status
           FROM workflow_subject_escalations
          WHERE tenant_id = $1
            AND workflow_id = $2
          ORDER BY created_at DESC
          LIMIT 20`,
        [tenantId, workflowId],
      ),
      db.query<ToolResultRow>(
        `SELECT mutation_outcome,
                recovery_class,
                response
           FROM workflow_tool_results
          WHERE tenant_id = $1
            AND workflow_id = $2
            AND mutation_outcome IS NOT NULL
          ORDER BY created_at DESC
          LIMIT 20`,
        [tenantId, workflowId],
      ),
    ]);

  const workflow = workflowRes.rows[0];
  if (!workflow) {
    return null;
  }
  const stageRows = stagesRes;
  const lifecycle = workflow.lifecycle === 'ongoing' ? 'ongoing' : 'planned';
  const definition = parsePlaybookDefinition(workflow.playbook_definition);
  const roleDefinitions = await loadPlaybookRoleDefinitions(
    db,
    tenantId,
    workflow.playbook_definition,
  );
  const projection = deriveWorkflowStageProjection({
    lifecycle,
    stageRows,
    openWorkItemStageNames: activeStageNames(workItemsRes.rows),
    definition: workflow.playbook_definition,
  });
  const serializedWorkItems = workItemsRes.rows.map(serializeWorkItem);
  const serializedTasks = tasksRes.rows.map(serializeDates);
  const focus = selectClosureContextFocus(task, activationRes.rows, serializedWorkItems);
  const pendingDispatches = derivePendingDispatches(serializedWorkItems, serializedTasks, definition);
  const closureContext = buildClosureContext({
    definition,
    lifecycle,
    workItems: serializedWorkItems,
    tasks: serializedTasks,
    stageGates: stageGatesRes.rows,
    escalations: escalationsRes.rows,
    toolResults: toolResultsRes.rows,
    focusWorkItemId: focus.workItemId,
    focusStageName: focus.stageName,
  });
  const workflowContext = {
    id: workflow.id,
    name: workflow.name,
    lifecycle: workflow.lifecycle,
    active_stages: projection.activeStages,
    metadata: workflow.metadata ?? {},
    playbook: {
      name: workflow.playbook_name,
      outcome: workflow.playbook_outcome,
      definition: workflow.playbook_definition,
    },
    role_definitions: roleDefinitions,
  } as Record<string, unknown>;
  if (workflow.lifecycle !== 'ongoing') {
    workflowContext.current_stage = projection.currentStage;
  }

  return {
    activation: activationRes.rows[0] ? serializeActivationBatch(activationId ?? activationRes.rows[0].id, activationRes.rows) : null,
    last_activation_checkpoint:
      Object.keys(asRecord(taskMetadata.last_activation_checkpoint)).length > 0
        ? asRecord(taskMetadata.last_activation_checkpoint)
        : null,
    closure_context: closureContext,
    workflow: workflowContext,
    board: {
      work_items: serializedWorkItems,
      stages: stageRows,
      tasks: serializedTasks,
      pending_dispatches: pendingDispatches,
    queued_activations: queuedActivationsRes.rows.map(serializeDates),
    },
  };
}
