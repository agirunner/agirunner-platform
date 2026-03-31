import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createOrchestratorControlApp, createTaskService } from './support.js';
import { orchestratorControlRoutes } from '../../../../src/api/routes/orchestrator-control.routes.js';

describe('orchestratorControlRoutes', () => {
  let app: ReturnType<typeof createOrchestratorControlApp> | undefined;

  beforeEach(() => {
    app = undefined;
  });

  it('creates a fresh reviewer task when the latest delivery handoff revision is newer than stale delivery task metadata on the same work item', async () => {
    const reviewWorkItemId = '24242424-2424-4242-8242-242424242424';
    const createdTask = {
      id: 'task-reviewer-revision-3-from-handoff',
      workflow_id: 'workflow-1',
      work_item_id: reviewWorkItemId,
      stage_name: 'review',
      role: 'reviewer',
      state: 'pending',
      metadata: {
        subject_task_id: 'task-developer',
        subject_revision: 3,
        task_kind: 'assessment',
      },
    };
    const taskService = createTaskService(createdTask);
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'create_task', 'create-review-revision-3-from-handoff']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes("COALESCE(metadata->>'subject_task_id'")) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            reviewWorkItemId,
            'reviewer',
            ['pending', 'ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_assessment', 'completed'],
            'task-developer',
            3,
          ]);
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
        if (sql.includes('FROM task_handoffs th') && sql.includes("COALESCE(th.role_data->>'task_kind', 'delivery') = 'delivery'")) {
          expect(params).toEqual(['tenant-1', 'workflow-1', reviewWorkItemId]);
          return {
            rowCount: 1,
            rows: [{
              subject_task_id: 'task-developer',
              subject_work_item_id: reviewWorkItemId,
              subject_revision: 3,
            }],
          };
        }
        if (sql.includes('SELECT id, rework_count, input, metadata, is_orchestrator_task') && sql.includes('FROM tasks')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-developer']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-developer',
              rework_count: 1,
              input: {},
              metadata: {
                task_kind: 'delivery',
                output_revision: 2,
              },
              is_orchestrator_task: false,
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-orchestrator']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-orchestrator',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: reviewWorkItemId,
              stage_name: 'review',
              activation_id: 'activation-review-revision-3-from-handoff',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('LEFT JOIN workflow_work_items parent')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', reviewWorkItemId]);
          return {
            rowCount: 1,
            rows: [{
              id: reviewWorkItemId,
              stage_name: 'review',
              parent_work_item_id: null,
              parent_id: null,
              parent_stage_name: null,
              workflow_lifecycle: 'planned',
            }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workflow_activations wa')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-review-revision-3-from-handoff']);
          return {
            rowCount: 1,
            rows: [{
              lifecycle: 'planned',
              event_type: 'task.handoff_submitted',
              payload: {
                task_id: 'task-developer',
                work_item_id: reviewWorkItemId,
                stage_name: 'review',
              },
            }],
          };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(async () => client),
    };

    app = createOrchestratorControlApp(pool, taskService);
    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/tasks',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'create-review-revision-3-from-handoff',
        title: 'Review revision 3 output',
        description: 'Review the third delivery revision from the latest handoff.',
        work_item_id: reviewWorkItemId,
        stage_name: 'review',
        role: 'reviewer',
        type: 'assessment',
        metadata: { task_kind: 'assessment' },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(taskService.getTask).not.toHaveBeenCalled();
    expect(taskService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      expect.objectContaining({
        role: 'reviewer',
        type: 'assessment',
        input: expect.objectContaining({
          subject_task_id: 'task-developer',
          subject_revision: 3,
        }),
        metadata: expect.objectContaining({
          subject_task_id: 'task-developer',
          subject_revision: 3,
          task_kind: 'assessment',
          created_by_orchestrator_task_id: 'task-orchestrator',
          orchestrator_activation_id: 'activation-review-revision-3-from-handoff',
        }),
      }),
      client,
    );
    expect(response.json().data).toEqual(createdTask);
  });
});
