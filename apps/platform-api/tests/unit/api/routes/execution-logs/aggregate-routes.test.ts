import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../src/auth/fastify-auth-hook.js', () => ({
  authenticateApiKey: async (request: { auth?: unknown }) => {
    request.auth = {
      id: 'key-1',
      tenantId: 'tenant-1',
      scope: 'operator',
      ownerType: 'user',
      ownerId: 'user-1',
      keyPrefix: 'prefix',
    };
  },
  withScope: () => async () => {},
}));

vi.mock('../../../../../src/auth/rbac.js', () => ({
  withRole: () => async () => {},
}));

import { registerErrorHandler } from '../../../../../src/errors/error-handler.js';
import { createExecutionLogsLogService } from './support.js';

describe('execution-logs route helpers', () => {
  let app: ReturnType<typeof fastify> | undefined;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  async function registerRoutesWithSpies(input: {
    operations?: ReturnType<typeof vi.fn>;
    roles?: ReturnType<typeof vi.fn>;
    actors?: ReturnType<typeof vi.fn>;
    stats?: ReturnType<typeof vi.fn>;
  } = {}) {
    const { executionLogRoutes } = await import('../../../../../src/api/routes/execution-logs/execution-logs.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('config', { EVENT_STREAM_KEEPALIVE_INTERVAL_MS: 1000 });
    app.decorate('logStreamService', { subscribe: vi.fn(() => () => {}) });
    app.decorate('logService', createExecutionLogsLogService({
      insertBatch: vi.fn(),
      query: vi.fn(),
      getById: vi.fn(),
      export: vi.fn(),
      stats: input.stats ?? vi.fn().mockResolvedValue({ groups: [], totals: {} }),
      operationValues: vi.fn().mockResolvedValue([]),
      roleValues: vi.fn().mockResolvedValue([]),
      actorKindValues: vi.fn().mockResolvedValue([]),
      workflowValues: vi.fn().mockResolvedValue([]),
      operations: input.operations ?? vi.fn().mockResolvedValue([]),
      roles: input.roles ?? vi.fn().mockResolvedValue([]),
      actors: input.actors ?? vi.fn().mockResolvedValue([]),
    }));

    await app.register(executionLogRoutes);
    return app.logService as {
      stats: ReturnType<typeof vi.fn>;
      operationValues: ReturnType<typeof vi.fn>;
      roleValues: ReturnType<typeof vi.fn>;
      actorKindValues: ReturnType<typeof vi.fn>;
      workflowValues: ReturnType<typeof vi.fn>;
      operations: ReturnType<typeof vi.fn>;
      roles: ReturnType<typeof vi.fn>;
      actors: ReturnType<typeof vi.fn>;
    };
  }

  it('passesFullParsedFiltersToOperations', async () => {
    const logService = await registerRoutesWithSpies();

    const response = await app!.inject({
      method: 'GET',
      url: '/api/v1/logs/operations?category=agent_loop,tool,llm,task_lifecycle,container&workflow_id=wf-1&level=warn&role=developer&actor_kind=specialist_task_execution&search=timeout',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(logService.operations).toHaveBeenCalledTimes(1);
    expect(logService.operations).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        category: ['agent_loop', 'tool', 'llm', 'task_lifecycle', 'container'],
        workflowId: 'wf-1',
        level: 'warn',
        role: ['developer'],
        actorKind: ['specialist_task_execution'],
        search: 'timeout',
      }),
    );
  });

  it('usesDistinctOperationValuesWhenRequested', async () => {
    const logService = await registerRoutesWithSpies();

    const response = await app!.inject({
      method: 'GET',
      url: '/api/v1/logs/operations?mode=values&workflow_id=wf-1',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(logService.operationValues).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        workflowId: 'wf-1',
      }),
    );
    expect(logService.operations).not.toHaveBeenCalled();
  });

  it('passesFullParsedFiltersToRoles', async () => {
    const logService = await registerRoutesWithSpies();

    const response = await app!.inject({
      method: 'GET',
      url: '/api/v1/logs/roles?workflow_id=wf-1&operation=tool.exec&actor_kind=specialist_task_execution',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(logService.roles).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        workflowId: 'wf-1',
        operation: ['tool.exec'],
        actorKind: ['specialist_task_execution'],
      }),
    );
  });

  it('passesFullParsedFiltersToActors', async () => {
    const logService = await registerRoutesWithSpies();

    const response = await app!.inject({
      method: 'GET',
      url: '/api/v1/logs/actors?workflow_id=wf-1&operation=tool.exec&role=developer',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(logService.actors).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        workflowId: 'wf-1',
        operation: ['tool.exec'],
        role: ['developer'],
      }),
    );
  });

  it('returnsWorkflowValueRowsForLogScopeDropdowns', async () => {
    const logService = await registerRoutesWithSpies({
      actors: vi.fn().mockResolvedValue([]),
    });
    logService.workflowValues.mockResolvedValue([
      { id: 'wf-1', name: 'Customer migration', workspace_id: 'ws-1' },
    ]);

    const response = await app!.inject({
      method: 'GET',
      url: '/api/v1/logs/workflows?workspace_id=ws-1',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(logService.workflowValues).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        workspaceId: 'ws-1',
      }),
    );
    expect(response.json()).toEqual({
      data: [{ id: 'wf-1', name: 'Customer migration', workspace_id: 'ws-1' }],
    });
  });

  it('returnsActorRowsWithRepresentativeContext', async () => {
    const logService = await registerRoutesWithSpies({
      actors: vi.fn().mockResolvedValue([
        {
          actor_kind: 'specialist_agent',
          actor_id: null,
          actor_name: null,
          count: 12,
          latest_role: 'developer',
          latest_workflow_id: 'wf-1',
          latest_workflow_name: 'Customer migration',
          latest_workflow_label: 'Customer migration',
        },
      ]),
    });

    const response = await app!.inject({
      method: 'GET',
      url: '/api/v1/logs/actors',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(logService.actors).toHaveBeenCalledTimes(1);
    expect(response.json()).toEqual({
      data: [
        {
          actor_kind: 'specialist_agent',
          actor_id: null,
          actor_name: null,
          count: 12,
          latest_role: 'developer',
          latest_workflow_id: 'wf-1',
          latest_workflow_name: 'Customer migration',
          latest_workflow_label: 'Customer migration',
        },
      ],
    });
  });

  it('passesFullParsedFiltersToStats', async () => {
    const logService = await registerRoutesWithSpies();

    const response = await app!.inject({
      method: 'GET',
      url: '/api/v1/logs/stats?group_by=category&workflow_id=wf-1&level=warn&operation=tool.exec&role=developer&actor_kind=specialist_task_execution&search=timeout',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(logService.stats).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        groupBy: 'category',
        workflowId: 'wf-1',
        level: 'warn',
        operation: ['tool.exec'],
        role: ['developer'],
        actorKind: ['specialist_task_execution'],
        search: 'timeout',
      }),
    );
  });
});
