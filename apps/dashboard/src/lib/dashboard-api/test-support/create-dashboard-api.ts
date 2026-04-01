import { vi } from 'vitest';

import { clearSession } from '../../auth/session.js';

export function resetDashboardApiTestEnvironment() {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  mockBrowserStorage();
  clearSession();
}

export function createDashboardApiClientStub(overrides: Record<string, unknown> = {}) {
  return {
    refreshSession: vi.fn(),
    setAccessToken: vi.fn(),
    listWorkflows: vi.fn(),
    exchangeApiKey: vi.fn(),
    getWorkflow: vi.fn(),
    createWorkflow: vi.fn(),
    listTasks: vi.fn(),
    getTask: vi.fn(),
    listWorkers: vi.fn(),
    listAgents: vi.fn(),
    ...overrides,
  };
}

function mockBrowserStorage() {
  const localStore = new Map<string, string>();
  const sessionStore = new Map<string, string>();
  vi.stubGlobal('localStorage', createStorage(localStore));
  vi.stubGlobal('sessionStorage', createStorage(sessionStore));
}

function createStorage(store: Map<string, string>) {
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
}
