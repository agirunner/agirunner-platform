import { DEFAULT_TENANT_ID } from '../platform-env.js';
import { sqlText, sqlUuid } from '../workflows-common.js';

const FIXTURE_WORKSPACE_SLUG_PREFIX = 'workflows-';
const FIXTURE_PLAYBOOK_SLUG_PREFIXES = ['planned-workflows-', 'ongoing-workflows-'] as const;

export function buildFixturePurgeSql(): string {
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
                 WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
                   AND ${workspaceFilter}
              )
              OR playbook_id IN (
                SELECT id
                  FROM public.playbooks
                 WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
                   AND ${playbookFilter}
              )
            )`;
  return `
    WITH fixture_workspaces AS (
      SELECT id
        FROM public.workspaces
       WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
         AND slug LIKE ${sqlText(`${FIXTURE_WORKSPACE_SLUG_PREFIX}%`)}
    ),
    fixture_playbooks AS (
      SELECT id
        FROM public.playbooks
       WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
         AND (
           slug LIKE ${sqlText(`${FIXTURE_PLAYBOOK_SLUG_PREFIXES[0]}%`)}
           OR slug LIKE ${sqlText(`${FIXTURE_PLAYBOOK_SLUG_PREFIXES[1]}%`)}
         )
    ),
    fixture_workflows AS (
      SELECT id
        FROM public.workflows
       WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
         AND COALESCE(name, '') LIKE 'E2E %'
         AND (
           workspace_id IN (SELECT id FROM fixture_workspaces)
           OR playbook_id IN (SELECT id FROM fixture_playbooks)
         )
    ),
    fixture_tasks AS (
      SELECT id
        FROM public.tasks
       WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
         AND workflow_id IN (SELECT id FROM fixture_workflows)
    )
    UPDATE public.agents
       SET current_task_id = NULL,
           status = (CASE WHEN status = 'inactive' THEN 'inactive' ELSE 'idle' END)::agent_status
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
       AND current_task_id IN (SELECT id FROM fixture_tasks);

    WITH fixture_workspaces AS (
      SELECT id
        FROM public.workspaces
       WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
         AND slug LIKE ${sqlText(`${FIXTURE_WORKSPACE_SLUG_PREFIX}%`)}
    ),
    fixture_playbooks AS (
      SELECT id
        FROM public.playbooks
       WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
         AND (
           slug LIKE ${sqlText(`${FIXTURE_PLAYBOOK_SLUG_PREFIXES[0]}%`)}
           OR slug LIKE ${sqlText(`${FIXTURE_PLAYBOOK_SLUG_PREFIXES[1]}%`)}
         )
    ),
    fixture_workflows AS (
      SELECT id
        FROM public.workflows
       WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
         AND COALESCE(name, '') LIKE 'E2E %'
         AND (
           workspace_id IN (SELECT id FROM fixture_workspaces)
           OR playbook_id IN (SELECT id FROM fixture_playbooks)
         )
    ),
    fixture_tasks AS (
      SELECT id
        FROM public.tasks
       WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
         AND workflow_id IN (SELECT id FROM fixture_workflows)
    )
    UPDATE public.workers
       SET current_task_id = NULL
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
       AND current_task_id IN (SELECT id FROM fixture_tasks);

    DELETE FROM public.integration_actions
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
       AND task_id IN (
         SELECT id
           FROM public.tasks
          WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
            AND workflow_id IN (
              SELECT id
                FROM public.workflows
               WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
                 AND ${workflowFilter}
            )
       );

    DELETE FROM public.worker_signals
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
       AND task_id IN (
         SELECT id
           FROM public.tasks
          WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
            AND workflow_id IN (
              SELECT id
                FROM public.workflows
               WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
                 AND ${workflowFilter}
            )
       );

    DELETE FROM public.task_handoffs
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
       AND (
         workflow_id IN (
           SELECT id
             FROM public.workflows
            WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
              AND ${workflowFilter}
         )
         OR task_id IN (
           SELECT id
             FROM public.tasks
            WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
              AND workflow_id IN (
                SELECT id
                  FROM public.workflows
                 WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
                   AND ${workflowFilter}
              )
         )
       );

    DELETE FROM public.task_tool_results
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
       AND task_id IN (
         SELECT id
           FROM public.tasks
          WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
            AND workflow_id IN (
              SELECT id
                FROM public.workflows
               WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
                 AND ${workflowFilter}
            )
       );

    DELETE FROM public.execution_container_leases
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
       AND task_id IN (
         SELECT id
           FROM public.tasks
          WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
            AND workflow_id IN (
              SELECT id
                FROM public.workflows
               WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
                 AND ${workflowFilter}
            )
       );

    DELETE FROM public.orchestrator_task_messages
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
       AND (
         workflow_id IN (
           SELECT id
             FROM public.workflows
            WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
              AND ${workflowFilter}
         )
         OR task_id IN (
           SELECT id
             FROM public.tasks
            WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
              AND workflow_id IN (
                SELECT id
                  FROM public.workflows
                 WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
                   AND ${workflowFilter}
              )
         )
         OR orchestrator_task_id IN (
           SELECT id
             FROM public.tasks
            WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
              AND workflow_id IN (
                SELECT id
                  FROM public.workflows
                 WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
                   AND ${workflowFilter}
              )
         )
       );

    DELETE FROM public.workflow_subject_escalations
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
       AND workflow_id IN (
         SELECT id
           FROM public.workflows
          WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
            AND ${workflowFilter}
       );

    DELETE FROM public.workflow_stage_gates
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
       AND workflow_id IN (
         SELECT id
           FROM public.workflows
          WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
            AND ${workflowFilter}
       );

    DELETE FROM public.workflow_intervention_files
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
       AND workflow_id IN (
         SELECT id
           FROM public.workflows
          WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
            AND ${workflowFilter}
       );

    DELETE FROM public.workflow_interventions
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
       AND workflow_id IN (
         SELECT id
           FROM public.workflows
          WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
            AND ${workflowFilter}
       );

    DELETE FROM public.workflow_input_packet_files
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
       AND workflow_id IN (
         SELECT id
           FROM public.workflows
          WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
            AND ${workflowFilter}
       );

    DELETE FROM public.workflow_input_packets
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
       AND workflow_id IN (
         SELECT id
           FROM public.workflows
          WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
            AND ${workflowFilter}
       );

    DELETE FROM public.workflow_output_descriptors
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
       AND workflow_id IN (
         SELECT id
           FROM public.workflows
          WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
            AND ${workflowFilter}
       );

    DELETE FROM public.workflow_operator_updates
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
       AND workflow_id IN (
         SELECT id
           FROM public.workflows
          WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
            AND ${workflowFilter}
       );

    DELETE FROM public.workflow_operator_briefs
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
       AND workflow_id IN (
         SELECT id
           FROM public.workflows
          WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
            AND ${workflowFilter}
       );

    DELETE FROM public.workflow_documents
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
      AND (
        workflow_id IN (
           SELECT id
             FROM public.workflows
            WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
              AND ${workflowFilter}
         )
         OR workspace_id IN (
           SELECT id
             FROM public.workspaces
            WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
              AND ${workspaceFilter}
         )
       );

    DELETE FROM public.workflow_artifacts
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
       AND (
         workflow_id IN (
           SELECT id
             FROM public.workflows
            WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
              AND ${workflowFilter}
         )
         OR task_id IN (
           SELECT id
             FROM public.tasks
            WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
              AND workflow_id IN (
                SELECT id
                  FROM public.workflows
                 WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
                   AND ${workflowFilter}
              )
         )
       );

    DELETE FROM public.workflow_tool_results
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
       AND workflow_id IN (
         SELECT id
           FROM public.workflows
          WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
            AND ${workflowFilter}
       );

    DELETE FROM public.orchestrator_grants
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
       AND workflow_id IN (
         SELECT id
           FROM public.workflows
          WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
            AND ${workflowFilter}
       );

    DELETE FROM public.execution_logs
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
       AND (
         workflow_id IN (
           SELECT id
             FROM public.workflows
            WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
              AND ${workflowFilter}
         )
         OR workspace_id IN (
           SELECT id
             FROM public.workspaces
            WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
              AND ${workspaceFilter}
         )
       );

    DELETE FROM public.workflow_steering_messages
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
       AND workflow_id IN (
         SELECT id
           FROM public.workflows
          WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
            AND ${workflowFilter}
       );

    DELETE FROM public.workflow_steering_sessions
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
       AND workflow_id IN (
         SELECT id
           FROM public.workflows
          WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
            AND ${workflowFilter}
       );

    DELETE FROM public.events
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
       AND (
        (entity_type = 'workflow' AND entity_id IN (
          SELECT id
             FROM public.workflows
            WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
              AND ${workflowFilter}
         ))
        OR (entity_type = 'task' AND entity_id IN (
          SELECT id
             FROM public.tasks
            WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
              AND workflow_id IN (
                SELECT id
                  FROM public.workflows
                 WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
                   AND ${workflowFilter}
              )
         ))
         OR data->>'workflow_id' IN (
           SELECT id::text
             FROM public.workflows
            WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
              AND ${workflowFilter}
         )
       );

    DELETE FROM public.workflow_branches
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
       AND workflow_id IN (
         SELECT id
           FROM public.workflows
          WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
            AND ${workflowFilter}
       );

    DELETE FROM public.workflow_stages
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
       AND workflow_id IN (
         SELECT id
           FROM public.workflows
          WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
            AND ${workflowFilter}
       );

    DELETE FROM public.workflow_activations
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
       AND workflow_id IN (
         SELECT id
           FROM public.workflows
          WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
            AND ${workflowFilter}
       );

    DELETE FROM public.tasks
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
       AND workflow_id IN (
         SELECT id
           FROM public.workflows
          WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
            AND ${workflowFilter}
       );

    DELETE FROM public.workflow_work_items
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
       AND workflow_id IN (
         SELECT id
           FROM public.workflows
          WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
            AND ${workflowFilter}
       );

    DELETE FROM public.tasks
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
       AND workflow_id IN (
         SELECT id
           FROM public.workflows
          WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
            AND ${workflowFilter}
       );

    DELETE FROM public.workflows
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
       AND ${workflowFilter};

    DELETE FROM public.workspaces
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
       AND ${workspaceFilter};

    DELETE FROM public.playbooks
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
       AND ${playbookFilter};
  `;
}
