import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildTaskPlatformHandoffsApp, registerTaskPlatformHandoffsRoutes } from './support.js';

describe('task platform handoff routes validation', () => {
  let app: Awaited<ReturnType<typeof buildTaskPlatformHandoffsApp>> | undefined;
  const artifactLocalRoot = 'tmp/artifacts';

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('rejects handoff submissions that still use legacy review_focus', async () => {
    app = buildTaskPlatformHandoffsApp(async (sql: string) => {
      if (sql.includes('FROM tasks') && sql.includes('assigned_agent_id')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'task-1',
            workflow_id: 'workflow-1',
            workspace_id: 'workspace-1',
            work_item_id: 'work-item-1',
            stage_name: 'implementation',
            activation_id: null,
            assigned_agent_id: 'agent-1',
            is_orchestrator_task: false,
            state: 'in_progress',
          }],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await registerTaskPlatformHandoffsRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-1/handoff',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'req-1',
        summary: 'Implemented auth flow.',
        completion: 'full',
        review_focus: ['error handling'],
      },
    });

    expect(response.statusCode).toBe(422);
  });

  it('rejects handoff submissions that omit completion', async () => {
    app = buildTaskPlatformHandoffsApp(async (sql: string) => {
      if (sql.includes('FROM tasks') && sql.includes('assigned_agent_id')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'task-1',
            workflow_id: 'workflow-1',
            workspace_id: 'workspace-1',
            work_item_id: 'work-item-1',
            stage_name: 'implementation',
            activation_id: null,
            assigned_agent_id: 'agent-1',
            is_orchestrator_task: false,
            state: 'in_progress',
          }],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await registerTaskPlatformHandoffsRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-1/handoff',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'req-1',
        summary: 'Implemented auth flow.',
      },
    });

    expect(response.statusCode).toBe(422);
  });

  it('rejects handoff submissions that still use partial completion', async () => {
    app = buildTaskPlatformHandoffsApp(async (sql: string) => {
      if (sql.includes('FROM tasks') && sql.includes('assigned_agent_id')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'task-1',
            workflow_id: 'workflow-1',
            workspace_id: 'workspace-1',
            work_item_id: 'work-item-1',
            stage_name: 'review',
            activation_id: null,
            assigned_agent_id: 'agent-1',
            is_orchestrator_task: false,
            state: 'in_progress',
          }],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await registerTaskPlatformHandoffsRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-1/handoff',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'req-1',
        summary: 'Request changes.',
        completion: 'partial',
      },
    });

    expect(response.statusCode).toBe(422);
  });

  it('rejects resolution on non-review task handoffs', async () => {
    app = buildTaskPlatformHandoffsApp(async (sql: string) => {
      if (sql.includes('FROM tasks') && sql.includes('assigned_agent_id')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'task-1',
            workflow_id: 'workflow-1',
            workspace_id: 'workspace-1',
            work_item_id: 'work-item-1',
            stage_name: 'requirements',
            activation_id: null,
            assigned_agent_id: 'agent-1',
            is_orchestrator_task: false,
            state: 'in_progress',
          }],
        };
      }
      if (sql.includes('FROM tasks') && sql.includes('LIMIT 1')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'task-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            role: 'product-manager',
            stage_name: 'requirements',
            state: 'in_progress',
            rework_count: 0,
            metadata: { team_name: 'delivery' },
          }],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await registerTaskPlatformHandoffsRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-1/handoff',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'req-1',
        summary: 'Requirements drafted.',
        completion: 'full',
        resolution: 'approved',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('resolution');
  });

  it('rejects continue as an explicit outcome action on handoff submission', async () => {
    app = buildTaskPlatformHandoffsApp(async (sql: string) => {
      if (sql.includes('FROM tasks') && sql.includes('assigned_agent_id')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'task-1',
            workflow_id: 'workflow-1',
            workspace_id: 'workspace-1',
            work_item_id: 'work-item-1',
            stage_name: 'review',
            activation_id: null,
            assigned_agent_id: 'agent-1',
            is_orchestrator_task: false,
            state: 'in_progress',
          }],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await registerTaskPlatformHandoffsRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-1/handoff',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'req-1',
        summary: 'Assessment completed.',
        completion: 'full',
        resolution: 'approved',
        outcome_action_applied: 'continue',
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.message).toContain('Invalid request body');
  });

  it('rejects handoff submissions that omit request_id', async () => {
    app = buildTaskPlatformHandoffsApp(async (sql: string) => {
      if (sql.includes('FROM tasks') && sql.includes('assigned_agent_id')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'task-1',
            workflow_id: 'workflow-1',
            workspace_id: 'workspace-1',
            work_item_id: 'work-item-1',
            stage_name: 'implementation',
            activation_id: null,
            assigned_agent_id: 'agent-1',
            is_orchestrator_task: false,
            state: 'in_progress',
          }],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await registerTaskPlatformHandoffsRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-1/handoff',
      headers: { authorization: 'Bearer test' },
      payload: {
        summary: 'Implemented auth flow.',
        completion: 'full',
      },
    });

    expect(response.statusCode).toBe(422);
  });

  it('returns schema error detail for unexpected handoff fields', async () => {
    app = buildTaskPlatformHandoffsApp(async (sql: string) => {
      if (sql.includes('FROM tasks') && sql.includes('assigned_agent_id')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'task-1',
            workflow_id: 'workflow-1',
            workspace_id: 'workspace-1',
            work_item_id: 'work-item-1',
            stage_name: 'review',
            activation_id: null,
            assigned_agent_id: 'agent-1',
            is_orchestrator_task: false,
            state: 'in_progress',
          }],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await registerTaskPlatformHandoffsRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-1/handoff',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'req-1',
        summary: 'Assessment completed.',
        completion: 'full',
        resolution: 'approved',
        next_expected_actor: 'orchestrator',
        next_expected_action: 'dispatch',
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.message).toContain('Invalid request body');
    expect(response.json().error.message).toContain('Unrecognized key');
  });
});
