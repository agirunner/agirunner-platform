import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildTaskPlatformHandoffsApp, registerTaskPlatformHandoffsRoutes } from './support.js';

describe('task platform handoff routes predecessor handoff lookup', () => {
  let app: Awaited<ReturnType<typeof buildTaskPlatformHandoffsApp>> | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('returns the predecessor handoff for the active task owner', async () => {
    app = buildTaskPlatformHandoffsApp(async (sql: string) => {
      if (sql.includes('FROM tasks') && sql.includes('assigned_agent_id')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'task-2',
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
      if (sql.includes('FROM tasks') && sql.includes('LIMIT 1')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'task-2',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            role: 'reviewer',
            stage_name: 'review',
            state: 'in_progress',
            rework_count: 0,
            metadata: {},
          }],
        };
      }
      if (sql.includes('FROM task_handoffs')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'handoff-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            task_id: 'task-1',
            request_id: 'req-1',
            role: 'developer',
            team_name: 'delivery',
            stage_name: 'implementation',
            sequence: 0,
            summary: 'Implemented auth flow.',
            completion: 'full',
            changes: [],
            decisions: [],
            remaining_items: [],
            blockers: [],
            focus_areas: ['error handling'],
            known_risks: [],
            successor_context: null,
            role_data: {},
            artifact_ids: [],
            created_at: new Date('2026-03-15T12:00:00Z'),
          }],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await registerTaskPlatformHandoffsRoutes(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks/task-2/predecessor-handoff',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual(
      expect.objectContaining({
        id: 'handoff-1',
        role: 'developer',
      }),
    );
  });

  it('returns the parent-linked predecessor handoff for a successor work item', async () => {
    app = buildTaskPlatformHandoffsApp(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM tasks') && sql.includes('assigned_agent_id')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'task-release-1',
            workflow_id: 'workflow-1',
            workspace_id: 'workspace-1',
            work_item_id: 'work-item-release',
            stage_name: 'release',
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
            id: 'task-release-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-release',
            role: 'product-manager',
            stage_name: 'release',
            state: 'in_progress',
            rework_count: 0,
            metadata: {},
          }],
        };
      }
      if (
        sql.includes('FROM task_handoffs') &&
        sql.includes('AND work_item_id = $3') &&
        Array.isArray(params) &&
        params[2] === 'work-item-release'
      ) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('COUNT(*)::int AS sibling_count')) {
        return {
          rowCount: 1,
          rows: [{ sibling_count: 1 }],
        };
      }
      if (sql.includes('FROM workflow_work_items') && sql.includes('parent_work_item_id')) {
        return {
          rowCount: 1,
          rows: [{ parent_work_item_id: 'work-item-verification' }],
        };
      }
      if (
        sql.includes('FROM task_handoffs') &&
        sql.includes('AND work_item_id = $3') &&
        Array.isArray(params) &&
        params[2] === 'work-item-verification'
      ) {
        return {
          rowCount: 1,
          rows: [{
            id: 'handoff-qa-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-verification',
            task_id: 'task-qa-1',
            request_id: 'req-qa-1',
            role: 'qa',
            team_name: null,
            stage_name: 'verification',
            sequence: 0,
            summary: 'QA validated the branch successfully.',
            completion: 'full',
            changes: [],
            decisions: ['Release can proceed'],
            remaining_items: [],
            blockers: [],
            focus_areas: ['Human release approval'],
            known_risks: [],
            successor_context: 'Use the QA evidence for release approval.',
            role_data: {},
            artifact_ids: [],
            created_at: new Date('2026-03-16T12:00:00Z'),
          }],
        };
      }
      if (sql.includes('FROM task_handoffs') && sql.includes('ORDER BY created_at DESC')) {
        return { rowCount: 0, rows: [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await registerTaskPlatformHandoffsRoutes(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks/task-release-1/predecessor-handoff',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual(
      expect.objectContaining({
        id: 'handoff-qa-1',
        role: 'qa',
        successor_context: 'Use the QA evidence for release approval.',
      }),
    );
  });

  it('returns null when parent fallback is ambiguous across sibling work items', async () => {
    app = buildTaskPlatformHandoffsApp(async (sql: string) => {
      if (sql.includes('FROM tasks') && sql.includes('assigned_agent_id')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'task-release-2',
            workflow_id: 'workflow-1',
            workspace_id: 'workspace-1',
            work_item_id: 'work-item-release',
            stage_name: 'release',
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
            id: 'task-release-2',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-release',
            role: 'product-manager',
            stage_name: 'release',
            state: 'in_progress',
            rework_count: 0,
            metadata: {},
          }],
        };
      }
      if (sql.includes('FROM task_handoffs') && sql.includes('AND work_item_id = $3')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('COUNT(*)::int AS sibling_count')) {
        return {
          rowCount: 1,
          rows: [{ sibling_count: 2 }],
        };
      }
      if (sql.includes('FROM workflow_work_items') && sql.includes('parent_work_item_id')) {
        return {
          rowCount: 1,
          rows: [{ parent_work_item_id: 'work-item-verification' }],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await registerTaskPlatformHandoffsRoutes(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks/task-release-2/predecessor-handoff',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toBeNull();
  });
});
