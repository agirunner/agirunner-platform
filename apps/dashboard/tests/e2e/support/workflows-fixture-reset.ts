import { ADMIN_API_KEY, PLATFORM_API_URL } from './platform-env.js';

const FIXTURE_WORKSPACE_SLUG_PREFIX = 'workflows-';
const FIXTURE_PLAYBOOK_SLUG_PREFIXES = ['planned-workflows-', 'ongoing-workflows-'] as const;
const TERMINAL_WORKFLOW_STATES = new Set(['completed', 'failed', 'cancelled']);
const PAGE_SIZE = 100;

interface ApiRecord {
  id: string;
  slug?: string;
  name?: string;
  state?: string;
  workspace_id?: string;
  playbook_id?: string;
}

interface ApiPage<T> {
  data: T[];
  meta?: {
    page?: number;
    pages?: number;
  };
}

export async function resetWorkflowsState(): Promise<void> {
  const workspaces = await listPaginated<ApiRecord>('/api/v1/workspaces');
  const fixtureWorkspaceIds = workspaces
    .filter(isFixtureWorkspace)
    .map((workspace) => workspace.id);

  const playbooks = await apiDataRequest<ApiRecord[]>('/api/v1/playbooks');
  const fixturePlaybookIds = playbooks
    .filter(isFixturePlaybook)
    .map((playbook) => playbook.id);

  const workflows = await listPaginated<ApiRecord>('/api/v1/workflows');
  const blockingWorkflows = workflows.filter(
    (workflow) =>
      isActiveWorkflow(workflow)
      && !isFixtureWorkflow(workflow, fixtureWorkspaceIds, fixturePlaybookIds),
  );
  if (blockingWorkflows.length > 0) {
    throw new Error(
      `Refusing to seed dashboard E2E workflows over active non-fixture workflows: ${blockingWorkflows
        .map((workflow) => `${workflow.name ?? workflow.id} (${workflow.id})`)
        .join(', ')}`,
    );
  }

  for (const workspaceId of fixtureWorkspaceIds) {
    await apiDataRequest(`/api/v1/workspaces/${workspaceId}?cascade=true`, {
      method: 'DELETE',
    });
  }

  for (const playbookId of fixturePlaybookIds) {
    await apiDataRequest(`/api/v1/playbooks/${playbookId}/permanent`, {
      method: 'DELETE',
    });
  }
}

function isFixtureWorkspace(workspace: ApiRecord): boolean {
  return typeof workspace.slug === 'string'
    && workspace.slug.startsWith(FIXTURE_WORKSPACE_SLUG_PREFIX);
}

function isFixturePlaybook(playbook: ApiRecord): boolean {
  if (typeof playbook.slug !== 'string') {
    return false;
  }
  return FIXTURE_PLAYBOOK_SLUG_PREFIXES.some((prefix) => playbook.slug?.startsWith(prefix));
}

function isActiveWorkflow(workflow: ApiRecord): boolean {
  return typeof workflow.state === 'string' && !TERMINAL_WORKFLOW_STATES.has(workflow.state);
}

function isFixtureWorkflow(
  workflow: ApiRecord,
  fixtureWorkspaceIds: string[],
  fixturePlaybookIds: string[],
): boolean {
  if (typeof workflow.name === 'string' && workflow.name.startsWith('E2E ')) {
    return true;
  }
  return fixtureWorkspaceIds.includes(workflow.workspace_id ?? '')
    || fixturePlaybookIds.includes(workflow.playbook_id ?? '');
}

async function listPaginated<T extends ApiRecord>(path: string): Promise<T[]> {
  const items: T[] = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const response = await apiJsonRequest<ApiPage<T>>(
      `${path}?page=${page}&per_page=${PAGE_SIZE}`,
    );
    items.push(...response.data);
    totalPages = Math.max(response.meta?.pages ?? 1, 1);
    page += 1;
  }

  return items;
}

async function apiDataRequest<T>(
  path: string,
  init: { method?: string; body?: Record<string, unknown> } = {},
): Promise<T> {
  const payload = await apiJsonRequest<{ data: T }>(path, init);
  return payload.data;
}

async function apiJsonRequest<T>(
  path: string,
  init: { method?: string; body?: Record<string, unknown> } = {},
): Promise<T> {
  const response = await fetch(`${PLATFORM_API_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${ADMIN_API_KEY}`,
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  if (!response.ok) {
    throw new Error(
      `API request failed ${init.method ?? 'GET'} ${path}: ${response.status} ${await response.text()}`,
    );
  }
  return (await response.json()) as T;
}
