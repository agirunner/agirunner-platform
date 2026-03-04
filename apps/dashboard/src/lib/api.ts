import { PlatformApiClient } from '@agentbaton/sdk';

import { clearSession, readSession, writeSession } from './session.js';

const API_BASE_URL = import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';

interface DashboardApiOptions {
  baseUrl?: string;
  client?: PlatformApiClient;
  fetcher?: typeof fetch;
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

export const dashboardApi = createDashboardApi();
