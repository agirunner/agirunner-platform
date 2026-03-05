import { PlatformApiClient } from '@agentbaton/sdk';

import { clearSession, readSession, writeSession } from './session.js';

const API_BASE_URL = import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';

interface DashboardApiOptions {
  baseUrl?: string;
  client?: PlatformApiClient;
  fetcher?: typeof fetch;
}

interface NamedRecord {
  id: string;
  name?: string;
  title?: string;
  state?: string;
  status?: string;
}

export interface DashboardSearchResult {
  type: 'pipeline' | 'task' | 'worker' | 'agent';
  id: string;
  label: string;
  subtitle: string;
  href: string;
}

export interface DashboardApi {
  login(apiKey: string): Promise<void>;
  logout(): void;
  listPipelines(): Promise<unknown>;
  getPipeline(id: string): Promise<unknown>;
  listTasks(filters?: Record<string, string>): Promise<unknown>;
  getTask(id: string): Promise<unknown>;
  listWorkers(): Promise<unknown>;
  listAgents(): Promise<unknown>;
  approveTask(taskId: string): Promise<unknown>;
  retryTask(taskId: string, payload?: { override_input?: Record<string, unknown>; force?: boolean }): Promise<unknown>;
  cancelTask(taskId: string): Promise<unknown>;
  search(query: string): Promise<DashboardSearchResult[]>;
  getMetrics(): Promise<string>;
}

export function createDashboardApi(options: DashboardApiOptions = {}): DashboardApi {
  const baseUrl = options.baseUrl ?? API_BASE_URL;
  const session = readSession();
  const client =
    options.client ??
    new PlatformApiClient({
      baseUrl,
      accessToken: session?.accessToken ?? undefined,
    });
  const requestFetch = options.fetcher ?? fetch;

  async function withRefresh<T>(handler: () => Promise<T>): Promise<T> {
    try {
      return await handler();
    } catch (error) {
      const message = String(error);
      if (!message.includes('HTTP 401')) {
        throw error;
      }

      const activeSession = readSession();
      if (!activeSession) {
        throw error;
      }

      try {
        const refreshed = await client.refreshSession();
        writeSession({
          accessToken: refreshed.token,
          tenantId: activeSession.tenantId,
        });
        client.setAccessToken(refreshed.token);
        return handler();
      } catch (refreshError) {
        clearSession();
        if (typeof window !== 'undefined') {
          window.location.assign('/login');
        }
        throw refreshError;
      }
    }
  }

  async function postJson(path: string, body?: Record<string, unknown>): Promise<unknown> {
    const activeSession = readSession();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (activeSession?.accessToken) {
      headers.Authorization = `Bearer ${activeSession.accessToken}`;
    }

    const response = await requestFetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
  }

  return {
    async login(apiKey: string): Promise<void> {
      const auth = await client.exchangeApiKey(apiKey);
      writeSession({
        accessToken: auth.token,
        tenantId: auth.tenant_id,
      });
      client.setAccessToken(auth.token);
    },
    logout(): void {
      clearSession();
    },
    listPipelines: () => withRefresh(() => client.listPipelines()),
    getPipeline: (id) => withRefresh(() => client.getPipeline(id)),
    listTasks: (filters) => withRefresh(() => client.listTasks(filters)),
    getTask: (id) => withRefresh(() => client.getTask(id)),
    listWorkers: () => withRefresh(() => client.listWorkers()),
    listAgents: () => withRefresh(() => client.listAgents()),
    approveTask: (taskId) => withRefresh(() => postJson(`/api/v1/tasks/${taskId}/approve`)),
    retryTask: (taskId, payload = {}) => withRefresh(() => postJson(`/api/v1/tasks/${taskId}/retry`, payload)),
    cancelTask: (taskId) => withRefresh(() => postJson(`/api/v1/tasks/${taskId}/cancel`)),
    search: (query) =>
      withRefresh(async () => {
        const normalizedQuery = query.trim().toLowerCase();
        if (normalizedQuery.length < 2) {
          return [];
        }

        const [pipelines, tasks, workers, agents] = await Promise.allSettled([
          client.listPipelines({ per_page: 50 }),
          client.listTasks({ per_page: 50 }),
          client.listWorkers(),
          client.listAgents(),
        ]);

        return buildSearchResults(normalizedQuery, {
          pipelines: extractListResult(pipelines),
          tasks: extractListResult(tasks),
          workers: extractDataResult(workers),
          agents: extractDataResult(agents),
        });
      }),
    getMetrics: () =>
      withRefresh(async () => {
        const activeSession = readSession();
        const headers = activeSession?.accessToken
          ? {
              Authorization: `Bearer ${activeSession.accessToken}`,
            }
          : undefined;

        const response = await requestFetch(`${baseUrl}/metrics`, {
          headers,
          credentials: 'include',
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        return response.text();
      }),
  };
}

export function buildSearchResults(
  normalizedQuery: string,
  collections: {
    pipelines: NamedRecord[];
    tasks: NamedRecord[];
    workers: NamedRecord[];
    agents: NamedRecord[];
  },
): DashboardSearchResult[] {
  const pipelineMatches = filterRecords(collections.pipelines, normalizedQuery).map((item) => ({
    type: 'pipeline' as const,
    id: item.id,
    label: item.name ?? item.id,
    subtitle: item.state ?? 'pipeline',
    href: `/pipelines/${item.id}`,
  }));

  const taskMatches = filterRecords(collections.tasks, normalizedQuery).map((item) => ({
    type: 'task' as const,
    id: item.id,
    label: item.title ?? item.name ?? item.id,
    subtitle: item.state ?? 'task',
    href: `/tasks/${item.id}`,
  }));

  const workerMatches = filterRecords(collections.workers, normalizedQuery).map((item) => ({
    type: 'worker' as const,
    id: item.id,
    label: item.name ?? item.id,
    subtitle: item.status ?? 'worker',
    href: '/workers',
  }));

  const agentMatches = filterRecords(collections.agents, normalizedQuery).map((item) => ({
    type: 'agent' as const,
    id: item.id,
    label: item.name ?? item.id,
    subtitle: item.status ?? 'agent',
    href: '/workers',
  }));

  return [...pipelineMatches, ...taskMatches, ...workerMatches, ...agentMatches].slice(0, 12);
}

function filterRecords(records: NamedRecord[], query: string): NamedRecord[] {
  return records.filter((record) => {
    const haystack = `${record.id} ${record.name ?? ''} ${record.title ?? ''}`.toLowerCase();
    return haystack.includes(query);
  });
}

function extractListResult(
  result: PromiseSettledResult<unknown>,
): NamedRecord[] {
  if (result.status !== 'fulfilled') {
    return [];
  }

  const value = result.value as { data?: unknown };
  return Array.isArray(value.data) ? (value.data as NamedRecord[]) : [];
}

function extractDataResult(result: PromiseSettledResult<unknown>): NamedRecord[] {
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

export const dashboardApi = createDashboardApi();
