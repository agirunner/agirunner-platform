import { PlatformApiClient } from '@agentbaton/sdk';

import { clearSession, readSession, writeSession } from './session.js';

const API_BASE_URL = import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';

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

export function createDashboardApi(): DashboardApi {
  const session = readSession();
  const client = new PlatformApiClient({
    baseUrl: API_BASE_URL,
    accessToken: session?.accessToken ?? undefined,
  });

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

      const refreshed = await client.refreshSession();
      writeSession({
        accessToken: refreshed.token,
        tenantId: activeSession.tenantId,
      });
      client.setAccessToken(refreshed.token);
      return handler();
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
        if (!activeSession?.accessToken) {
          throw new Error('HTTP 401: missing access token');
        }

        const response = await fetch(`${API_BASE_URL}/metrics`, {
          headers: {
            Authorization: `Bearer ${activeSession.accessToken}`,
          },
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
