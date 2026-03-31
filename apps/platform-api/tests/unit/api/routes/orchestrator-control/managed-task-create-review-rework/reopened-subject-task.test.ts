import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createOrchestratorControlApp, createTaskService } from './support.js';
import { orchestratorControlRoutes } from '../../../../../../src/api/routes/orchestrator-control/routes.js';

describe('orchestratorControlRoutes', () => {
  let app: ReturnType<typeof createOrchestratorControlApp> | undefined;

  beforeEach(() => {
    app = undefined;
  });

  it('returns the reopened subject task when assessment_requested_changes already reactivated it', async () => {
    const implementationWorkItemId = '33333333-3333-4333-8333-333333333333';
    const verificationWorkItemId = '44444444-4444-4444-8444-444444444444';
    const existingTask = {
      id: 'task-developer',
      workflow_id: 'workflow-1',
      work_item_id: implementationWorkItemId,
      stage_name: 'implementation',
      role: 'live-test-developer',
      state: 'in_progress',
      metadata: {
        assessment_action: 'request_changes',
      },
    };
    const taskService = createTaskService();
    taskService.getTask = vi.fn().mockResolvedValue(existingTask);
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'create_task', 'create-rework-reuse-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workflow_activations wa')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-rework']);
          return {
            rowCount: 1,
            rows: [{
              lifecycle: 'planned',
              event_type: 'task.assessment_requested_changes',
              payload: {
                task_id: existingTask.id,
                task_role: 'live-test-developer',
                stage_name: 'implementation',
                work_item_id: implementationWorkItemId,
              },
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('AND workflow_id = $2') && sql.includes('AND id = $3')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            existingTask.id,
            'live-test-developer',
            ['pending', 'ready', 'claimed', 'in_progress', 'output_pending_assessment'],
          ]);
          return {
            rowCount: 1,
            rows: [{ id: existingTask.id }],
          };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return { rowCount: 1, rows: [{ response: existingTask }] };
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
              workspace_id: 'workspace-1',
              work_item_id: implementationWorkItemId,
              stage_name: 'implementation',
              activation_id: 'activation-rework',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('LEFT JOIN workflow_work_items parent')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', verificationWorkItemId]);
          return {
            rowCount: 1,
            rows: [{
              id: verificationWorkItemId,
              stage_name: 'verification',
              parent_work_item_id: 'review-item',
              parent_id: 'review-item',
              parent_stage_name: 'review',
              workflow_lifecycle: 'planned',
            }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workflow_activations wa')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-rework']);
          return {
            rowCount: 1,
            rows: [{
              lifecycle: 'planned',
              event_type: 'task.assessment_requested_changes',
              payload: {
                task_id: existingTask.id,
                task_role: 'live-test-developer',
                stage_name: 'implementation',
                work_item_id: implementationWorkItemId,
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
        request_id: 'create-rework-reuse-1',
        title: 'Add invalid-input stderr coverage and rerun greeting regression suite',
        description: 'Handle QA-requested rework.',
        work_item_id: verificationWorkItemId,
        stage_name: 'verification',
        role: 'live-test-developer',
        type: 'code',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(taskService.createTask).not.toHaveBeenCalled();
    expect(taskService.getTask).toHaveBeenCalledWith('tenant-1', existingTask.id);
    expect(response.json().data).toEqual(existingTask);
  });
});
