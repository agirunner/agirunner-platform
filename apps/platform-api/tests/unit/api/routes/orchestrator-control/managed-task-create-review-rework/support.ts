import fastify from 'fastify';
import { vi } from 'vitest';

import { registerErrorHandler } from '../../../../../../src/errors/error-handler.js';

vi.mock('../../../../../../src/auth/fastify-auth-hook.js', () => ({
  authenticateApiKey: async (request: { auth?: unknown }) => {
    request.auth = {
      id: 'key-1',
      tenantId: 'tenant-1',
      scope: 'agent',
      ownerType: 'agent',
      ownerId: 'agent-1',
      keyPrefix: 'agent-key',
    };
  },
  withScope: () => async () => {},
}));

export function createOrchestratorControlApp(
  pool: Record<string, unknown>,
  taskService: Record<string, unknown>,
) {
  const app = fastify();
  registerErrorHandler(app);
  app.decorate('pgPool', pool as never);
  app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 } as never);
  app.decorate('eventService', { emit: vi.fn(async () => undefined) } as never);
  app.decorate(
    'workflowService',
    { createWorkflowWorkItem: vi.fn(), getWorkflowWorkItem: vi.fn() } as never,
  );
  app.decorate('taskService', taskService as never);
  app.decorate('workspaceService', {
    patchWorkspaceMemory: vi.fn(),
    removeWorkspaceMemory: vi.fn(),
  } as never);
  return app;
}

export function createTaskService(createdTask?: Record<string, unknown>) {
  return {
    createTask: vi.fn().mockResolvedValue(createdTask),
    getTask: vi.fn(),
  };
}
