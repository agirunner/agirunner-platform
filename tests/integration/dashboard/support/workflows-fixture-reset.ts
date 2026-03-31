import { execFileSync } from 'node:child_process';

import {
  ADMIN_API_KEY,
  DEFAULT_TENANT_ID,
  PLATFORM_API_URL,
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
  slug?: string;
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

  if (fixtureWorkflowIds.length > 0) {
    await apiDataRequest('/api/v1/workflows/bulk-delete', {
      method: 'POST',
      body: { workflow_ids: fixtureWorkflowIds },
    });
  }

  for (const workspaceId of fixtureWorkspaceIds) {
    await apiDataRequest(`/api/v1/workspaces/${workspaceId}`, {
      method: 'DELETE',
      allowNotFound: true,
    });
  }

  for (const playbookId of fixturePlaybookIds) {
    await apiDataRequest(`/api/v1/playbooks/${playbookId}`, {
      method: 'DELETE',
      allowNotFound: true,
    });
  }
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

function queryScalarValues(sql: string): string[] {
  return queryRows(sql).map(([value]) => value);
}

function queryRows(sql: string): string[][] {
  const output = execFileSync(
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
  ).trim();
  if (!output) {
    return [];
  }
  return output
    .split('\n')
    .map((line) => line.split('|').map((value) => value.trim()))
    .filter((row) => row.some((value) => value.length > 0));
}

function sqlText(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlUuid(value: string): string {
  return `${sqlText(value)}::uuid`;
}

async function apiDataRequest<T>(
  path: string,
  init: { method?: string; body?: Record<string, unknown>; allowNotFound?: boolean } = {},
): Promise<T> {
  const payload = await apiJsonRequest<{ data: T }>(path, init);
  return payload.data;
}

async function apiJsonRequest<T>(
  path: string,
  init: { method?: string; body?: Record<string, unknown>; allowNotFound?: boolean } = {},
): Promise<T> {
  const hasBody = init.body !== undefined;
  const response = await fetch(`${PLATFORM_API_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${ADMIN_API_KEY}`,
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
    },
    body: hasBody ? JSON.stringify(init.body) : undefined,
  });
  if (!response.ok) {
    const responseText = await response.text();
    if (init.allowNotFound && response.status === 404) {
      return ({ data: null } satisfies { data: null }) as T;
    }
    throw new Error(
      `API request failed ${init.method ?? 'GET'} ${path}: ${response.status} ${responseText}`,
    );
  }
  return (await response.json()) as T;
}
