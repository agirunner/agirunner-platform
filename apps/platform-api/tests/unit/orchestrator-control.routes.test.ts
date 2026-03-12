import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../src/errors/error-handler.js';
import {
  normalizeOrchestratorChildWorkflowLinkage,
  orchestratorControlRoutes,
} from '../../src/api/routes/orchestrator-control.routes.js';

vi.mock('../../src/auth/fastify-auth-hook.js', () => ({
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

describe('normalizeOrchestratorChildWorkflowLinkage', () => {
  it('backfills normalized parent-child metadata on both workflows without duplicating child ids', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ metadata: { child_workflow_ids: ['wf-child-1'] } }],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ metadata: { existing: true } }],
        })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] }),
    };

    await normalizeOrchestratorChildWorkflowLinkage(
      pool as never,
      'tenant-1',
      {
        parentWorkflowId: 'wf-parent',
        parentOrchestratorTaskId: 'task-orch-1',
        parentOrchestratorActivationId: 'activation-1',
        parentWorkItemId: 'wi-1',
        parentStageName: 'implementation',
        parentContext: 'Use the shared repo state.',
      },
      'wf-child-1',
    );

    expect(pool.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('UPDATE workflows'),
      [
        'tenant-1',
        'wf-parent',
        {
          child_workflow_ids: ['wf-child-1'],
          latest_child_workflow_id: 'wf-child-1',
          latest_child_workflow_created_by_orchestrator_task_id: 'task-orch-1',
        },
      ],
    );
    expect(pool.query).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('UPDATE workflows'),
      [
        'tenant-1',
        'wf-child-1',
        {
          existing: true,
          parent_workflow_id: 'wf-parent',
          parent_orchestrator_task_id: 'task-orch-1',
          parent_orchestrator_activation_id: 'activation-1',
          parent_work_item_id: 'wi-1',
          parent_stage_name: 'implementation',
          parent_context: 'Use the shared repo state.',
          parent_link_kind: 'orchestrator_child',
        },
      ],
    );
  });
});

describe('orchestratorControlRoutes', () => {
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

  it('replays stored create_work_item results after recovery without rerunning the mutation', async () => {
    const workflowService = {
      createWorkflowWorkItem: vi.fn(),
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
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'create_work_item',
            'smk120-item-1',
          ]);
          return {
            rowCount: 1,
            rows: [{
              response: {
                id: 'work-item-1',
                workflow_id: 'workflow-1',
                parent_work_item_id: null,
                stage_name: 'triage',
                title: 'Recovered work item',
                goal: 'Original replay-safe goal',
                acceptance_criteria: null,
                column_id: 'backlog',
                owner_role: null,
                priority: 'normal',
                notes: null,
                metadata: {},
                completed_at: null,
                updated_at: '2026-03-12T00:00:00.000Z',
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
          expect(params).toEqual(['tenant-1', 'task-replay']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-replay',
              workflow_id: 'workflow-1',
              project_id: 'project-1',
              work_item_id: null,
              stage_name: 'triage',
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
    app.decorate('projectService', {
      patchProjectMemory: vi.fn(),
      removeProjectMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-replay/work-items',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'smk120-item-1',
        title: 'Recovered work item',
        goal: 'Changed replay text after recovery',
        acceptance_criteria: 'Recovered acceptance criteria',
        stage_name: 'triage',
        column_id: 'backlog',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toEqual(
      expect.objectContaining({
        id: 'work-item-1',
        workflow_id: 'workflow-1',
        goal: 'Original replay-safe goal',
      }),
    );
    expect(workflowService.createWorkflowWorkItem).not.toHaveBeenCalled();
  });

  it('rejects create_work_item without request_id', async () => {
    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', { query: vi.fn(), connect: vi.fn() });
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', { createTask: vi.fn() });
    app.decorate('projectService', {
      patchProjectMemory: vi.fn(),
      removeProjectMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-replay/work-items',
      headers: { authorization: 'Bearer test' },
      payload: {
        title: 'Recovered work item',
        goal: 'Changed replay text after recovery',
        acceptance_criteria: 'Recovered acceptance criteria',
        stage_name: 'triage',
        column_id: 'backlog',
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('SCHEMA_VALIDATION_FAILED');
  });

  it('writes orchestrator memory into an explicitly targeted work-item scope', async () => {
    const workItemId = '11111111-1111-4111-8111-111111111111';
    const workflowService = {
      getWorkflowWorkItem: vi.fn().mockResolvedValue({ id: workItemId }),
    };
    const projectService = {
      patchProjectMemory: vi.fn().mockResolvedValue({ key: 'memory-key', work_item_id: workItemId }),
      removeProjectMemory: vi.fn(),
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
              project_id: 'project-1',
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
    app.decorate('projectService', projectService);

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
    expect(projectService.patchProjectMemory).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'project-1',
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

  it('rejects memory_delete without request_id', async () => {
    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', { query: vi.fn(), connect: vi.fn() });
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', { createTask: vi.fn() });
    app.decorate('projectService', {
      patchProjectMemory: vi.fn(),
      removeProjectMemory: vi.fn(),
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

  it('updates specialist task input through the idempotent orchestrator bridge', async () => {
    const updatedTask = {
      id: 'task-specialist',
      workflow_id: 'workflow-1',
      is_orchestrator_task: false,
      input: { scope: 'narrowed' },
    };
    const taskService = {
      createTask: vi.fn(),
      getTask: vi.fn().mockResolvedValue(updatedTask),
      updateTaskInput: vi.fn().mockResolvedValue(updatedTask),
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'update_task_input', 'task-input-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return { rowCount: 1, rows: [{ response: updatedTask }] };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-orchestrator']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-orchestrator',
              workflow_id: 'workflow-1',
              project_id: 'project-1',
              work_item_id: 'work-item-1',
              stage_name: 'implementation',
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
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn(), getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', taskService);
    app.decorate('projectService', {
      patchProjectMemory: vi.fn(),
      removeProjectMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/tasks/task-specialist/input',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'task-input-1',
        input: { scope: 'narrowed' },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(taskService.getTask).toHaveBeenCalledWith('tenant-1', 'task-specialist');
    expect(taskService.updateTaskInput).toHaveBeenCalledWith(
      'tenant-1',
      'task-specialist',
      { scope: 'narrowed' },
      client,
    );
    expect(response.json().data).toEqual(updatedTask);
  });

  it('creates a specialist task with the canonical orchestrator contract fields', async () => {
    const workItemId = '11111111-1111-4111-8111-111111111111';
    const createdTask = {
      id: 'task-specialist',
      workflow_id: 'workflow-1',
      work_item_id: workItemId,
      stage_name: 'implementation',
      role: 'developer',
      state: 'pending',
      metadata: {},
    };
    const taskService = {
      createTask: vi.fn().mockResolvedValue(createdTask),
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'create_task', 'create-task-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return { rowCount: 1, rows: [{ response: createdTask }] };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-orchestrator']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-orchestrator',
              workflow_id: 'workflow-1',
              project_id: 'project-1',
              work_item_id: null,
              stage_name: 'implementation',
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
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn(), getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', taskService);
    app.decorate('projectService', {
      patchProjectMemory: vi.fn(),
      removeProjectMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/tasks',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'create-task-1',
        title: 'Implement auth flow',
        description: 'Implement the authentication workflow end to end.',
        work_item_id: workItemId,
        stage_name: 'implementation',
        role: 'developer',
        type: 'code',
        credentials: {
          git_token_ref: 'secret:GITHUB_PAT',
        },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(taskService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      expect.objectContaining({
        title: 'Implement auth flow',
        description: 'Implement the authentication workflow end to end.',
        work_item_id: workItemId,
        stage_name: 'implementation',
        role: 'developer',
        type: 'code',
        credentials: {
          git_token_ref: 'secret:GITHUB_PAT',
        },
        metadata: expect.objectContaining({
          created_by_orchestrator_task_id: 'task-orchestrator',
          orchestrator_activation_id: 'activation-1',
        }),
      }),
      client,
    );
    expect(response.json().data).toEqual(createdTask);
  });

  it('rejects create_task when canonical required fields are missing', async () => {
    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', { query: vi.fn(), connect: vi.fn() });
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn(), getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', { createTask: vi.fn() });
    app.decorate('projectService', {
      patchProjectMemory: vi.fn(),
      removeProjectMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/tasks',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'create-task-2',
        title: 'Implement auth flow',
        work_item_id: '11111111-1111-4111-8111-111111111111',
        role: 'developer',
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('SCHEMA_VALIDATION_FAILED');
  });

  it('approves a specialist task through the replay-safe orchestrator bridge', async () => {
    const approvedTask = {
      id: 'task-specialist',
      workflow_id: 'workflow-1',
      is_orchestrator_task: false,
      state: 'ready',
    };
    const taskService = {
      createTask: vi.fn(),
      getTask: vi.fn().mockResolvedValue(approvedTask),
      approveTask: vi.fn().mockResolvedValue(approvedTask),
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'approve_task', 'approve-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return { rowCount: 1, rows: [{ response: approvedTask }] };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-orchestrator']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-orchestrator',
              workflow_id: 'workflow-1',
              project_id: 'project-1',
              work_item_id: 'work-item-1',
              stage_name: 'implementation',
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
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn(), getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', taskService);
    app.decorate('projectService', {
      patchProjectMemory: vi.fn(),
      removeProjectMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/tasks/task-specialist/approve',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'approve-1',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(taskService.approveTask).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'task-specialist',
      client,
    );
    expect(response.json().data).toEqual(approvedTask);
  });

  it('escalates a specialist task to human review through the replay-safe orchestrator bridge', async () => {
    const escalatedTask = {
      id: 'task-specialist',
      workflow_id: 'workflow-1',
      is_orchestrator_task: false,
      state: 'escalated',
    };
    const taskService = {
      createTask: vi.fn(),
      getTask: vi.fn().mockResolvedValue(escalatedTask),
      escalateTask: vi.fn().mockResolvedValue(escalatedTask),
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'escalate_to_human', 'escalate-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return { rowCount: 1, rows: [{ response: escalatedTask }] };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-orchestrator']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-orchestrator',
              workflow_id: 'workflow-1',
              project_id: 'project-1',
              work_item_id: 'work-item-1',
              stage_name: 'implementation',
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
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn(), getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', taskService);
    app.decorate('projectService', {
      patchProjectMemory: vi.fn(),
      removeProjectMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/tasks/task-specialist/escalate-to-human',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'escalate-1',
        reason: 'Needs product approval',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(taskService.escalateTask).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'task-specialist',
      {
        reason: 'Needs product approval',
        escalation_target: 'human',
      },
      client,
    );
    expect(response.json().data).toEqual(escalatedTask);
  });

  it('reads the scoped workflow budget for an orchestrator task', async () => {
    const workflowService = {
      getWorkflowBudget: vi.fn().mockResolvedValue({
        tokens_used: 1200,
        tokens_limit: 5000,
        cost_usd: 1.5,
      }),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-orch-budget']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-orch-budget',
              workflow_id: 'workflow-1',
              project_id: 'project-1',
              work_item_id: null,
              stage_name: 'implementation',
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
    app.decorate('workflowService', workflowService);
    app.decorate('taskService', { createTask: vi.fn() });
    app.decorate('projectService', {
      patchProjectMemory: vi.fn(),
      removeProjectMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/orchestrator/tasks/task-orch-budget/workflow/budget',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(workflowService.getWorkflowBudget).toHaveBeenCalledWith('tenant-1', 'workflow-1');
    expect(response.json().data).toEqual(
      expect.objectContaining({ tokens_used: 1200, cost_usd: 1.5 }),
    );
  });

  it('sends live managed-task messages through the worker connection hub', async () => {
    let committedMutation = false;
    const managedTask = {
      id: 'task-managed-1',
      workflow_id: 'workflow-1',
      is_orchestrator_task: false,
      state: 'in_progress',
      assigned_worker_id: 'worker-1',
      stage_name: 'implementation',
    };
    const taskService = {
      createTask: vi.fn(),
      getTask: vi.fn(),
    };
    const sendToWorker = vi.fn(() => {
      expect(committedMutation).toBe(true);
      return true;
    });
    const emit = vi.fn(async () => undefined);
    const messageRow = {
      id: 'message-1',
      tenant_id: 'tenant-1',
      workflow_id: 'workflow-1',
      task_id: 'task-managed-1',
      orchestrator_task_id: 'task-orch-message',
      activation_id: 'activation-1',
      stage_name: 'implementation',
      worker_id: 'worker-1',
      request_id: 'msg-1',
      urgency: 'important',
      message: 'Focus on the failing API regression first.',
      delivery_state: 'pending_delivery',
      delivery_attempt_count: 0,
      last_delivery_attempt_at: null,
      delivered_at: null,
      created_at: new Date('2026-03-12T00:00:00.000Z'),
    };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN') {
          return { rowCount: 0, rows: [] };
        }
        if (sql === 'COMMIT') {
          committedMutation = true;
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'send_task_message', 'msg-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return {
            rowCount: 1,
            rows: [{
              response: {
                success: true,
                delivered: false,
                task_id: 'task-managed-1',
                message_id: 'msg-1',
                urgency: 'important',
                delivery_state: 'pending_delivery',
              },
            }],
          };
        }
        if (sql.includes('SELECT id, workflow_id, is_orchestrator_task, state, assigned_worker_id, stage_name')) {
          expect(params).toEqual(['tenant-1', 'task-managed-1']);
          return {
            rowCount: 1,
            rows: [managedTask],
          };
        }
        if (sql.includes('INSERT INTO orchestrator_task_messages')) {
          return {
            rowCount: 1,
            rows: [messageRow],
          };
        }
        if (sql.includes('FROM orchestrator_task_messages') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [messageRow],
          };
        }
        if (sql.includes("SET delivery_state = 'delivery_in_progress'")) {
          return {
            rowCount: 1,
            rows: [
              {
                ...messageRow,
                delivery_state: 'delivery_in_progress',
                delivery_attempt_count: 1,
                last_delivery_attempt_at: new Date('2026-03-12T00:00:01.000Z'),
              },
            ],
          };
        }
        if (sql.includes('UPDATE orchestrator_task_messages') && sql.includes('delivered_at = CASE WHEN $2 = \'delivered\'')) {
          return {
            rowCount: 1,
            rows: [
              {
                ...messageRow,
                delivery_state: 'delivered',
                delivery_attempt_count: 1,
                last_delivery_attempt_at: new Date('2026-03-12T00:00:01.000Z'),
                delivered_at: new Date('2026-03-12T00:00:02.000Z'),
              },
            ],
          };
        }
        if (sql.includes('UPDATE workflow_tool_results')) {
          return {
            rowCount: 1,
            rows: [{
              response: {
                success: true,
                delivered: true,
                task_id: 'task-managed-1',
                message_id: 'msg-1',
                urgency: 'important',
                issued_at: '2026-03-12T00:00:00.000Z',
                delivery_state: 'delivered',
              },
            }],
          };
        }
        throw new Error(`unexpected client query: ${sql} ${JSON.stringify(params)}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-orch-message']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-orch-message',
              workflow_id: 'workflow-1',
              project_id: 'project-1',
              work_item_id: null,
              stage_name: 'implementation',
              activation_id: 'activation-1',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('UPDATE workflow_tool_results')) {
          return {
            rowCount: 1,
            rows: [{
              response: {
                success: true,
                delivered: true,
                task_id: 'task-managed-1',
                message_id: 'msg-1',
                urgency: 'important',
                issued_at: '2026-03-12T00:00:00.000Z',
                delivery_state: 'delivered',
              },
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
    app.decorate('eventService', { emit });
    app.decorate('workflowService', { getWorkflowBudget: vi.fn() });
    app.decorate('workerConnectionHub', { sendToWorker });
    app.decorate('taskService', taskService);
    app.decorate('projectService', {
      patchProjectMemory: vi.fn(),
      removeProjectMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orch-message/tasks/task-managed-1/message',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'msg-1',
        message: 'Focus on the failing API regression first.',
        urgency: 'important',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(taskService.getTask).not.toHaveBeenCalled();
    expect(sendToWorker).toHaveBeenCalledWith(
      'worker-1',
      expect.objectContaining({
        type: 'task.message',
        task_id: 'task-managed-1',
        message_id: 'msg-1',
        urgency: 'important',
      }),
    );
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.message_sent',
        entityId: 'task-managed-1',
      }),
      client,
    );
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.message_delivered',
        entityId: 'task-managed-1',
      }),
      client,
    );
    expect(response.json().data).toEqual(
      expect.objectContaining({
        success: true,
        delivered: true,
        message_id: 'msg-1',
        delivery_state: 'delivered',
      }),
    );
  });

  it('delivers a stored pending managed-task message on replay without reinserting it', async () => {
    const managedTask = {
      id: 'task-managed-1',
      workflow_id: 'workflow-1',
      is_orchestrator_task: false,
      state: 'in_progress',
      assigned_worker_id: 'worker-1',
      stage_name: 'implementation',
    };
    const taskService = {
      createTask: vi.fn(),
      getTask: vi.fn(),
    };
    const sendToWorker = vi.fn().mockReturnValue(true);
    const emit = vi.fn(async () => undefined);
    let messageRow: {
      id: string;
      tenant_id: string;
      workflow_id: string;
      task_id: string;
      orchestrator_task_id: string;
      activation_id: string;
      stage_name: string;
      worker_id: string;
      request_id: string;
      urgency: string;
      message: string;
      delivery_state: string;
      delivery_attempt_count: number;
      last_delivery_attempt_at: Date | null;
      delivered_at: Date | null;
      created_at: Date;
    } = {
      id: 'message-1',
      tenant_id: 'tenant-1',
      workflow_id: 'workflow-1',
      task_id: 'task-managed-1',
      orchestrator_task_id: 'task-orch-message',
      activation_id: 'activation-1',
      stage_name: 'implementation',
      worker_id: 'worker-1',
      request_id: 'msg-1',
      urgency: 'important',
      message: 'Focus on the failing API regression first.',
      delivery_state: 'pending_delivery',
      delivery_attempt_count: 0,
      last_delivery_attempt_at: null,
      delivered_at: null,
      created_at: new Date('2026-03-12T00:00:00.000Z'),
    };
    let toolResult: Record<string, unknown> = {
      success: true,
      delivered: false,
      task_id: 'task-managed-1',
      message_id: 'msg-1',
      urgency: 'important',
      issued_at: '2026-03-12T00:00:00.000Z',
      delivery_state: 'pending_delivery',
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
          return { rowCount: 1, rows: [{ response: toolResult }] };
        }
        if (sql.includes('INSERT INTO orchestrator_task_messages')) {
          throw new Error('replay should not insert a second task message row');
        }
        if (sql.includes('SELECT id, workflow_id, is_orchestrator_task, state, assigned_worker_id, stage_name')) {
          expect(params).toEqual(['tenant-1', 'task-managed-1']);
          return {
            rowCount: 1,
            rows: [managedTask],
          };
        }
        if (sql.includes('FROM orchestrator_task_messages') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [messageRow],
          };
        }
        if (sql.includes("SET delivery_state = 'delivery_in_progress'")) {
          messageRow = {
            ...messageRow,
            delivery_state: 'delivery_in_progress',
            delivery_attempt_count: 1,
            last_delivery_attempt_at: new Date('2026-03-12T00:00:01.000Z'),
          };
          return { rowCount: 1, rows: [messageRow] };
        }
        if (sql.includes('UPDATE orchestrator_task_messages') && sql.includes('delivered_at = CASE WHEN $2 = \'delivered\'')) {
          messageRow = {
            ...messageRow,
            delivery_state: 'delivered',
            delivery_attempt_count: 1,
            last_delivery_attempt_at: new Date('2026-03-12T00:00:01.000Z'),
            delivered_at: new Date('2026-03-12T00:00:02.000Z'),
          };
          return { rowCount: 1, rows: [messageRow] };
        }
        throw new Error(`unexpected client query: ${sql} ${JSON.stringify(params)}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-orch-message']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-orch-message',
              workflow_id: 'workflow-1',
              project_id: 'project-1',
              work_item_id: null,
              stage_name: 'implementation',
              activation_id: 'activation-1',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('UPDATE workflow_tool_results')) {
          toolResult = params?.[4] as Record<string, unknown>;
          return { rowCount: 1, rows: [{ response: toolResult }] };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(async () => client),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit });
    app.decorate('workflowService', { getWorkflowBudget: vi.fn() });
    app.decorate('workerConnectionHub', { sendToWorker });
    app.decorate('taskService', taskService);
    app.decorate('projectService', {
      patchProjectMemory: vi.fn(),
      removeProjectMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orch-message/tasks/task-managed-1/message',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'msg-1',
        message: 'Focus on the failing API regression first.',
        urgency: 'important',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(sendToWorker).toHaveBeenCalledTimes(1);
    expect(emit).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.message_sent',
      }),
      client,
    );
    expect(response.json().data).toEqual(
      expect.objectContaining({
        success: true,
        delivered: true,
        message_id: 'msg-1',
        delivery_state: 'delivered',
      }),
    );
  });
});
