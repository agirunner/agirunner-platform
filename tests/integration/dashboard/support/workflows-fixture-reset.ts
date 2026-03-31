import { execFileSync } from 'node:child_process';

import {
  DEFAULT_TENANT_ID,
  PLATFORM_API_CONTAINER_NAME,
  POSTGRES_CONTAINER_NAME,
  POSTGRES_DB,
  POSTGRES_USER,
} from './platform-env.js';

const FIXTURE_WORKSPACE_SLUG_PREFIX = 'workflows-';
const FIXTURE_PLAYBOOK_SLUG_PREFIXES = ['planned-workflows-', 'ongoing-workflows-'] as const;
const TERMINAL_WORKFLOW_STATES = new Set(['completed', 'failed', 'cancelled']);
const NON_LIVE_RUNTIME_CONTAINERS = [
  'orchestrator-primary-0',
  'orchestrator-primary-1',
  'agirunner-platform-container-manager-1',
] as const;

interface ApiRecord {
  id: string;
  name?: string;
}

export async function resetWorkflowsState(): Promise<void> {
  ensureNonLiveRuntimeQuiesced();
  const fixtureWorkspaceIds = selectFixtureWorkspaceIds();
  const fixturePlaybookIds = selectFixturePlaybookIds();
  const blockingWorkflows = selectBlockingWorkflows();
  const fixtureWorkflowIds = selectFixtureWorkflowIds();

  if (blockingWorkflows.length > 0) {
    throw new Error(
      `Refusing to seed dashboard E2E workflows over active non-fixture workflows: ${blockingWorkflows
        .map((workflow) => `${workflow.name ?? workflow.id} (${workflow.id})`)
        .join(', ')}`,
    );
  }

  if (
    fixtureWorkflowIds.length === 0
    && fixtureWorkspaceIds.length === 0
    && fixturePlaybookIds.length === 0
  ) {
    return;
  }

  runPsql(buildFixturePurgeSql());
  pruneOrphanedWorkflowArtifactDirectories();
}

function ensureNonLiveRuntimeQuiesced(): void {
  const runningContainers = execFileSync(
    'docker',
    ['ps', '--format', '{{.Names}}'],
    { encoding: 'utf8' },
  )
    .split('\n')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const containersToStop = NON_LIVE_RUNTIME_CONTAINERS.filter((name) =>
    runningContainers.includes(name),
  );
  if (containersToStop.length === 0) {
    return;
  }
  execFileSync('docker', ['stop', ...containersToStop], { stdio: 'pipe' });
}

function selectFixtureWorkspaceIds(): string[] {
  return queryScalarValues(`
    SELECT id::text
      FROM public.workspaces
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
       AND slug LIKE ${sqlText(`${FIXTURE_WORKSPACE_SLUG_PREFIX}%`)};
  `);
}

function selectFixturePlaybookIds(): string[] {
  return queryScalarValues(`
    SELECT id::text
      FROM public.playbooks
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
       AND (
         slug LIKE ${sqlText(`${FIXTURE_PLAYBOOK_SLUG_PREFIXES[0]}%`)}
         OR slug LIKE ${sqlText(`${FIXTURE_PLAYBOOK_SLUG_PREFIXES[1]}%`)}
       );
  `);
}

function selectBlockingWorkflows(): ApiRecord[] {
  return queryRows(`
    SELECT id::text, COALESCE(name, '') AS name
      FROM public.workflows
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
       AND state NOT IN (${Array.from(TERMINAL_WORKFLOW_STATES).map(sqlText).join(', ')})
       AND COALESCE(name, '') NOT LIKE 'E2E %'
       AND workspace_id NOT IN (
         SELECT id
           FROM public.workspaces
          WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
            AND slug LIKE ${sqlText(`${FIXTURE_WORKSPACE_SLUG_PREFIX}%`)}
       )
       AND playbook_id NOT IN (
         SELECT id
           FROM public.playbooks
          WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
            AND (
              slug LIKE ${sqlText(`${FIXTURE_PLAYBOOK_SLUG_PREFIXES[0]}%`)}
              OR slug LIKE ${sqlText(`${FIXTURE_PLAYBOOK_SLUG_PREFIXES[1]}%`)}
            )
       )
     ORDER BY updated_at DESC
     LIMIT 20;
  `).map(([id, name]) => ({ id, name }));
}

function selectFixtureWorkflowIds(): string[] {
  return queryScalarValues(`
    SELECT id::text
      FROM public.workflows
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
       AND COALESCE(name, '') LIKE 'E2E %'
       AND (
         workspace_id IN (
           SELECT id
             FROM public.workspaces
            WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
              AND slug LIKE ${sqlText(`${FIXTURE_WORKSPACE_SLUG_PREFIX}%`)}
         )
         OR playbook_id IN (
           SELECT id
             FROM public.playbooks
            WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
              AND (
                slug LIKE ${sqlText(`${FIXTURE_PLAYBOOK_SLUG_PREFIXES[0]}%`)}
                OR slug LIKE ${sqlText(`${FIXTURE_PLAYBOOK_SLUG_PREFIXES[1]}%`)}
              )
         )
       );
  `);
}

function selectTenantWorkflowIds(): string[] {
  return queryScalarValues(`
    SELECT id::text
      FROM public.workflows
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)};
  `);
}

function pruneOrphanedWorkflowArtifactDirectories(): void {
  const keepIds = selectTenantWorkflowIds().join('\n');
  const script = `
set -eu
root=${shellSingleQuote(`/artifacts/tenants/${DEFAULT_TENANT_ID}/workflows`)}
[ -d "$root" ] || exit 0
keep_ids=${shellSingleQuote(keepIds)}
find "$root" -mindepth 1 -maxdepth 1 -type d | while IFS= read -r workflow_dir; do
  workflow_id="$(basename "$workflow_dir")"
  if ! printf '%s\\n' "$keep_ids" | grep -Fxq "$workflow_id"; then
    rm -rf "$workflow_dir"
  fi
done
`;

  execFileSync(
    'docker',
    ['exec', '-i', PLATFORM_API_CONTAINER_NAME, 'sh', '-lc', script],
    { stdio: 'pipe' },
  );
}

function buildFixturePurgeSql(): string {
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
                 AND COALESCE(name, '') LIKE 'E2E %'
                 AND (
                   workspace_id IN (
                     SELECT id
                       FROM public.workspaces
                      WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
                        AND slug LIKE ${sqlText(`${FIXTURE_WORKSPACE_SLUG_PREFIX}%`)}
                   )
                   OR playbook_id IN (
                     SELECT id
                       FROM public.playbooks
                      WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
                        AND (
                          slug LIKE ${sqlText(`${FIXTURE_PLAYBOOK_SLUG_PREFIXES[0]}%`)}
                          OR slug LIKE ${sqlText(`${FIXTURE_PLAYBOOK_SLUG_PREFIXES[1]}%`)}
                        )
                   )
                 )
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
                 AND COALESCE(name, '') LIKE 'E2E %'
                 AND (
                   workspace_id IN (
                     SELECT id
                       FROM public.workspaces
                      WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
                        AND slug LIKE ${sqlText(`${FIXTURE_WORKSPACE_SLUG_PREFIX}%`)}
                   )
                   OR playbook_id IN (
                     SELECT id
                       FROM public.playbooks
                      WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
                        AND (
                          slug LIKE ${sqlText(`${FIXTURE_PLAYBOOK_SLUG_PREFIXES[0]}%`)}
                          OR slug LIKE ${sqlText(`${FIXTURE_PLAYBOOK_SLUG_PREFIXES[1]}%`)}
                        )
                   )
                 )
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

    DELETE FROM public.workflow_activations
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

function queryScalarValues(sql: string): string[] {
  return queryRows(sql).map(([value]) => value);
}

function queryRows(sql: string): string[][] {
  const output = runPsql(sql).trim();
  if (!output) {
    return [];
  }
  return output
    .split('\n')
    .map((line) => line.split('|').map((value) => value.trim()))
    .filter((row) => row.some((value) => value.length > 0));
}

function runPsql(sql: string): string {
  return execFileSync(
    'docker',
    [
      'exec',
      '-i',
      POSTGRES_CONTAINER_NAME,
      'psql',
      '-t',
      '-A',
      '-F',
      '|',
      '-U',
      POSTGRES_USER,
      '-d',
      POSTGRES_DB,
      '-c',
      sql,
    ],
    { encoding: 'utf8' },
  );
}

function sqlText(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlUuid(value: string): string {
  return `${sqlText(value)}::uuid`;
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}
