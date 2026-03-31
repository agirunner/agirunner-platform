import { DEFAULT_TENANT_ID } from '../platform-env.js';
import { sqlText, sqlUuid } from '../workflows-common.js';

const TENANT_ID_SQL = sqlUuid(DEFAULT_TENANT_ID);
const FIXTURE_WORKSPACE_SLUG_PREFIX = 'workflows-';
const FIXTURE_PLAYBOOK_SLUG_PREFIXES = ['planned-workflows-', 'ongoing-workflows-'] as const;

const workspaceFilter = `slug LIKE ${sqlText(`${FIXTURE_WORKSPACE_SLUG_PREFIX}%`)}`;
const playbookFilter = `(
         slug LIKE ${sqlText(`${FIXTURE_PLAYBOOK_SLUG_PREFIXES[0]}%`)}
         OR slug LIKE ${sqlText(`${FIXTURE_PLAYBOOK_SLUG_PREFIXES[1]}%`)}
       )`;
const workflowFilter = `COALESCE(name, '') LIKE 'E2E %'
          AND (
            workspace_id IN (
              SELECT id
                FROM public.workspaces
               WHERE tenant_id = ${TENANT_ID_SQL}
                 AND ${workspaceFilter}
            )
            OR playbook_id IN (
              SELECT id
                FROM public.playbooks
               WHERE tenant_id = ${TENANT_ID_SQL}
                 AND ${playbookFilter}
            )
          )`;

export function buildFixturePurgeSql(): string {
  const statements = [
    buildAgentResetSql(),
    buildWorkerResetSql(),
    buildWorkflowCancellationSql(),
    buildWorkflowDeleteSql('workflow_activations'),
    buildOrchestratorTasksDeleteSql(),
    buildTaskDeleteSql('integration_actions'),
    buildTaskDeleteSql('worker_signals'),
    buildTaskHandoffsDeleteSql(),
    buildTaskDeleteSql('task_tool_results'),
    buildTaskDeleteSql('execution_container_leases'),
    buildOrchestratorTaskMessagesDeleteSql(),
    buildWorkflowDeleteSql('workflow_subject_escalations'),
    buildWorkflowDeleteSql('workflow_stage_gates'),
    buildWorkflowDeleteSql('workflow_intervention_files'),
    buildWorkflowDeleteSql('workflow_interventions'),
    buildWorkflowDeleteSql('workflow_input_packet_files'),
    buildWorkflowDeleteSql('workflow_input_packets'),
    buildWorkflowDeleteSql('workflow_output_descriptors'),
    buildWorkflowDeleteSql('workflow_operator_updates'),
    buildWorkflowDeleteSql('workflow_operator_briefs'),
    buildWorkflowOrWorkspaceDeleteSql('workflow_documents'),
    buildWorkflowArtifactsDeleteSql(),
    buildWorkflowDeleteSql('workflow_tool_results'),
    buildWorkflowDeleteSql('orchestrator_grants'),
    buildWorkflowOrWorkspaceDeleteSql('execution_logs'),
    buildWorkflowDeleteSql('workflow_steering_messages'),
    buildWorkflowDeleteSql('workflow_steering_sessions'),
    buildEventsDeleteSql(),
    buildWorkflowDeleteSql('workflow_branches'),
    buildWorkflowDeleteSql('workflow_stages'),
    buildWorkflowDeleteSql('workflow_activations'),
    buildTasksDeleteByWorkflowSql(),
    buildWorkflowDeleteSql('workflow_work_items'),
    buildTasksDeleteByWorkflowSql(),
    buildWorkflowsDeleteSql(),
    buildWorkspacesDeleteSql(),
    buildPlaybooksDeleteSql(),
  ];

  return `\n${statements.join('\n\n')}\n`;
}

function buildAgentResetSql(): string {
  return `${buildFixtureTaskScopeCteSql()}
UPDATE public.agents
   SET current_task_id = NULL,
       status = (CASE WHEN status = 'inactive' THEN 'inactive' ELSE 'idle' END)::agent_status
 WHERE tenant_id = ${TENANT_ID_SQL}
   AND current_task_id IN (
${indentSql(fixtureTaskIdsSql(), 4)}
   );`;
}

function buildWorkerResetSql(): string {
  return `${buildFixtureTaskScopeCteSql()}
UPDATE public.workers
   SET current_task_id = NULL
 WHERE tenant_id = ${TENANT_ID_SQL}
   AND current_task_id IN (
${indentSql(fixtureTaskIdsSql(), 4)}
   );`;
}

function buildWorkflowCancellationSql(): string {
  return `UPDATE public.workflows
   SET state = 'cancelled'::public.workflow_state,
       lifecycle = 'planned',
       current_stage = COALESCE(current_stage, 'delivery'),
       updated_at = NOW()
 WHERE tenant_id = ${TENANT_ID_SQL}
   AND ${workflowFilter};`;
}

function buildWorkflowDeleteSql(table: string): string {
  return `DELETE FROM public.${table}
 WHERE tenant_id = ${TENANT_ID_SQL}
   AND ${inWorkflowClause('workflow_id')};`;
}

function buildOrchestratorTasksDeleteSql(): string {
  return `DELETE FROM public.tasks
 WHERE tenant_id = ${TENANT_ID_SQL}
   AND role = 'orchestrator'
   AND ${inWorkflowClause('workflow_id')};`;
}

function buildTaskDeleteSql(table: string): string {
  return `DELETE FROM public.${table}
 WHERE tenant_id = ${TENANT_ID_SQL}
   AND ${inTaskClause('task_id')};`;
}

function buildTaskHandoffsDeleteSql(): string {
  return `DELETE FROM public.task_handoffs
 WHERE tenant_id = ${TENANT_ID_SQL}
   AND (
     ${inWorkflowClause('workflow_id')}
     OR ${inTaskClause('task_id')}
   );`;
}

function buildOrchestratorTaskMessagesDeleteSql(): string {
  return `DELETE FROM public.orchestrator_task_messages
 WHERE tenant_id = ${TENANT_ID_SQL}
   AND (
     ${inWorkflowClause('workflow_id')}
     OR ${inTaskClause('task_id')}
     OR ${inTaskClause('orchestrator_task_id')}
   );`;
}

function buildWorkflowArtifactsDeleteSql(): string {
  return `DELETE FROM public.workflow_artifacts
 WHERE tenant_id = ${TENANT_ID_SQL}
   AND (
     ${inWorkflowClause('workflow_id')}
     OR ${inTaskClause('task_id')}
   );`;
}

function buildWorkflowOrWorkspaceDeleteSql(table: string): string {
  return `DELETE FROM public.${table}
 WHERE tenant_id = ${TENANT_ID_SQL}
   AND (
     ${inWorkflowClause('workflow_id')}
     OR ${inWorkspaceClause('workspace_id')}
   );`;
}

function buildEventsDeleteSql(): string {
  return `DELETE FROM public.events
 WHERE tenant_id = ${TENANT_ID_SQL}
   AND (
     (entity_type = 'workflow' AND ${inWorkflowClause('entity_id')})
     OR (entity_type = 'task' AND ${inTaskClause('entity_id')})
     OR data->>'workflow_id' IN (
${indentSql(workflowIdsTextSql(), 6)}
       )
   );`;
}

function buildTasksDeleteByWorkflowSql(): string {
  return `DELETE FROM public.tasks
 WHERE tenant_id = ${TENANT_ID_SQL}
   AND ${inWorkflowClause('workflow_id')};`;
}

function buildWorkflowsDeleteSql(): string {
  return `DELETE FROM public.workflows
 WHERE tenant_id = ${TENANT_ID_SQL}
   AND ${workflowFilter};`;
}

function buildWorkspacesDeleteSql(): string {
  return `DELETE FROM public.workspaces
 WHERE tenant_id = ${TENANT_ID_SQL}
   AND ${workspaceFilter};`;
}

function buildPlaybooksDeleteSql(): string {
  return `DELETE FROM public.playbooks
 WHERE tenant_id = ${TENANT_ID_SQL}
   AND ${playbookFilter};`;
}

function buildFixtureTaskScopeCteSql(): string {
  return `WITH fixture_workspaces AS (
${indentSql(workspaceIdsSql(), 2)}
),
fixture_playbooks AS (
${indentSql(playbookIdsSql(), 2)}
),
fixture_workflows AS (
${indentSql(workflowIdsSql(), 2)}
),
fixture_tasks AS (
${indentSql(fixtureTaskIdsSql(), 2)}
)`;
}

function workspaceIdsSql(): string {
  return `SELECT id
  FROM public.workspaces
 WHERE tenant_id = ${TENANT_ID_SQL}
   AND ${workspaceFilter}`;
}

function playbookIdsSql(): string {
  return `SELECT id
  FROM public.playbooks
 WHERE tenant_id = ${TENANT_ID_SQL}
   AND ${playbookFilter}`;
}

function workflowIdsSql(): string {
  return `SELECT id
  FROM public.workflows
 WHERE tenant_id = ${TENANT_ID_SQL}
   AND ${workflowFilter}`;
}

function workflowIdsTextSql(): string {
  return `SELECT id::text
  FROM public.workflows
 WHERE tenant_id = ${TENANT_ID_SQL}
   AND ${workflowFilter}`;
}

function taskIdsSql(): string {
  return `SELECT id
  FROM public.tasks
 WHERE tenant_id = ${TENANT_ID_SQL}
   AND ${inWorkflowClause('workflow_id')}`;
}

function fixtureTaskIdsSql(): string {
  return `SELECT id
  FROM public.tasks
 WHERE tenant_id = ${TENANT_ID_SQL}
   AND workflow_id IN (SELECT id FROM fixture_workflows)`;
}

function inWorkflowClause(column: string): string {
  return `${column} IN (
${indentSql(workflowIdsSql(), 2)}
   )`;
}

function inTaskClause(column: string): string {
  return `${column} IN (
${indentSql(taskIdsSql(), 2)}
   )`;
}

function inWorkspaceClause(column: string): string {
  return `${column} IN (
${indentSql(workspaceIdsSql(), 2)}
   )`;
}

function indentSql(sql: string, spaces: number): string {
  const padding = ' '.repeat(spaces);
  return sql
    .split('\n')
    .map((line) => `${padding}${line}`)
    .join('\n');
}
