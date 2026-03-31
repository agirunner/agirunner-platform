import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../../../../src/errors/error-handler.js';
import { ConflictError, NotFoundError, ValidationError } from '../../../../../src/errors/domain-errors.js';
import { ArtifactService } from '../../../../../src/services/artifacts/artifact-service.js';
import { GuidedClosureRecoveryHelpersService } from '../../../../../src/services/guided-closure/recovery-helpers.js';
import { PlaybookWorkflowControlService } from '../../../../../src/services/playbook-workflow-control/playbook-workflow-control-service.js';
import { TaskAgentScopeService } from '../../../../../src/services/task/task-agent-scope-service.js';
import {
  normalizeExplicitAssessmentSubjectTaskLinkage,
  normalizeOrchestratorChildWorkflowLinkage,
  orchestratorControlRoutes,
} from '../../../../../src/api/routes/orchestrator-control/routes.js';

vi.mock('../../../../../src/auth/fastify-auth-hook.js', () => ({
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


describe('orchestratorControlRoutes', () => {
  let app: ReturnType<typeof fastify> | undefined;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('writes orchestrator memory into an explicitly targeted work-item scope', async () => {
    const workItemId = '11111111-1111-4111-8111-111111111111';
    const workflowService = {
      getWorkflowWorkItem: vi.fn().mockResolvedValue({ id: workItemId }),
    };
    const workspaceService = {
      patchWorkspaceMemory: vi.fn().mockResolvedValue({ key: 'memory-key', work_item_id: workItemId }),
      removeWorkspaceMemory: vi.fn(),
    };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'memory_write', 'memory-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return {
            rowCount: 1,
            rows: [{ response: { key: 'memory-key', work_item_id: workItemId } }],
          };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-memory']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-memory',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: null,
              stage_name: 'requirements',
              activation_id: 'activation-1',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(async () => client),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', workflowService);
    app.decorate('taskService', { createTask: vi.fn() });
    app.decorate('workspaceService', workspaceService);

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-memory/memory',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'memory-1',
        key: 'memory-key',
        value: { summary: 'Scoped to the current work item' },
        work_item_id: workItemId,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(workflowService.getWorkflowWorkItem).toHaveBeenCalledWith(
      'tenant-1',
      'workflow-1',
      workItemId,
    );
    expect(workspaceService.patchWorkspaceMemory).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workspace-1',
      expect.objectContaining({
        key: 'memory-key',
        work_item_id: workItemId,
        context: expect.objectContaining({
          workflow_id: 'workflow-1',
          work_item_id: workItemId,
          task_id: 'task-memory',
        }),
      }),
      client,
    );
  });


  it('accepts design-shaped orchestrator memory updates objects through the replay-safe bridge', async () => {
    const workspaceService = {
      patchWorkspaceMemory: vi.fn(),
      patchWorkspaceMemoryEntries: vi.fn().mockResolvedValue({
        id: 'workspace-1',
        memory: {
          summary: 'Scoped note',
          decision: { outcome: 'ship' },
        },
      }),
      removeWorkspaceMemory: vi.fn(),
    };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'memory_write', 'memory-updates-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return {
            rowCount: 1,
            rows: [{
              response: {
                id: 'workspace-1',
                memory: {
                  summary: 'Scoped note',
                  decision: { outcome: 'ship' },
                },
              },
            }],
          };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-memory']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-memory',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: 'work-item-1',
              stage_name: 'requirements',
              activation_id: 'activation-1',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(async () => client),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { getWorkflowWorkItem: vi.fn(), createWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', { createTask: vi.fn() });
    app.decorate('workspaceService', workspaceService);

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-memory/memory',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'memory-updates-1',
        updates: {
          summary: 'Scoped note',
          decision: { outcome: 'ship' },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(workspaceService.patchWorkspaceMemoryEntries).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workspace-1',
      [
        {
          key: 'summary',
          value: 'Scoped note',
          context: {
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            task_id: 'task-memory',
            stage_name: 'requirements',
          },
        },
        {
          key: 'decision',
          value: { outcome: 'ship' },
          context: {
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            task_id: 'task-memory',
            stage_name: 'requirements',
          },
        },
      ],
      client,
    );
    expect(response.json().data.memory).toEqual({
      summary: 'Scoped note',
      decision: { outcome: 'ship' },
    });
  });


  it('rejects orchestrator memory writes that try to persist workflow status', async () => {
    const workspaceService = {
      patchWorkspaceMemory: vi.fn(),
      patchWorkspaceMemoryEntries: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-memory']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-memory',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: 'work-item-1',
              stage_name: 'requirements',
              activation_id: 'activation-1',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { getWorkflowWorkItem: vi.fn(), createWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', { createTask: vi.fn() });
    app.decorate('workspaceService', workspaceService);

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-memory/memory',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'memory-status-1',
        updates: {
          requirements_gate_status: {
            state: 'awaiting_human_approval',
            checkpoint: 'requirements',
            work_item_id: 'work-item-1',
          },
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    expect(workspaceService.patchWorkspaceMemoryEntries).not.toHaveBeenCalled();
  });


  it('rejects memory_delete without request_id', async () => {
    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', { query: vi.fn(), connect: vi.fn() });
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', { createTask: vi.fn() });
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/orchestrator/tasks/task-memory/memory/memory-key',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('SCHEMA_VALIDATION_FAILED');
  });



});
