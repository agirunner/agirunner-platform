import type { DashboardSearchResult, NamedRecord } from './contracts.js';

export function buildSearchResults(
  normalizedQuery: string,
  collections: {
    workflows: NamedRecord[];
    tasks: NamedRecord[];
    workers: NamedRecord[];
    agents: NamedRecord[];
    workspaces: NamedRecord[];
    playbooks: NamedRecord[];
  },
): DashboardSearchResult[] {
  const workflowMatches = filterRecords(collections.workflows, normalizedQuery).map((item) => ({
    type: 'workflow' as const,
    id: item.id,
    label: item.name ?? item.id,
    subtitle: item.state ?? 'workflow',
    href: `/workflows?rail=workflow&workflow=${encodeURIComponent(item.id)}`,
  }));

  const taskMatches = filterRecords(collections.tasks, normalizedQuery).map((item) => ({
    type: 'task' as const,
    id: item.id,
    label: item.title ?? item.name ?? item.id,
    subtitle: item.state ?? 'task',
    href: `/work/tasks/${item.id}`,
  }));

  const agentMatches = filterRecords(collections.agents, normalizedQuery).map((item) => ({
    type: 'agent' as const,
    id: item.id,
    label: item.name ?? item.id,
    subtitle: item.status ?? 'agent',
    href: '/diagnostics/live-containers',
  }));

  const workspaceMatches = filterRecords(collections.workspaces, normalizedQuery).map((item) => ({
    type: 'workspace' as const,
    id: item.id,
    label: item.name ?? item.id,
    subtitle: item.status ?? 'workspace',
    href: `/design/workspaces/${item.id}`,
  }));

  const playbookMatches = filterRecords(collections.playbooks, normalizedQuery).map((item) => ({
    type: 'playbook' as const,
    id: item.id,
    label: item.name ?? item.id,
    subtitle: item.status ?? 'playbook',
    href: `/design/playbooks/${item.id}`,
  }));

  return [
    ...workflowMatches,
    ...taskMatches,
    ...workspaceMatches,
    ...playbookMatches,
    ...agentMatches,
  ].slice(0, 12);
}

export function extractListResult(result: PromiseSettledResult<unknown>): NamedRecord[] {
  if (result.status !== 'fulfilled') {
    return [];
  }

  const value = result.value as { data?: unknown };
  return Array.isArray(value.data) ? (value.data as NamedRecord[]) : [];
}

export function extractDataResult(result: PromiseSettledResult<unknown>): NamedRecord[] {
  if (result.status !== 'fulfilled') {
    return [];
  }

  const value = result.value as { data?: unknown } | unknown[];
  if (Array.isArray(value)) {
    return value as NamedRecord[];
  }

  if (value && typeof value === 'object' && Array.isArray((value as { data?: unknown }).data)) {
    return (value as { data: NamedRecord[] }).data;
  }

  return [];
}

function filterRecords(records: NamedRecord[], query: string): NamedRecord[] {
  return records.filter((record) => {
    const haystack = `${record.id} ${record.name ?? ''} ${record.title ?? ''}`.toLowerCase();
    return haystack.includes(query);
  });
}
