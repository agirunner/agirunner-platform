import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  TaskWriteService,
  isPlaybookDefinitionLookup,
  resetTaskWriteServiceMocks,
} from './task-write-service-test-support.js';

describe('TaskWriteService planned-stage task creation', () => {
  beforeEach(() => {
    resetTaskWriteServiceMocks();
  });

  it('allows creating a planned-workflow task when the linked current stage gate is approved', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM tasks') && sql.includes('workflow_id = $2') && sql.includes('request_id = $3')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('LEFT JOIN workflow_stages ws')) {
          return {
            rowCount: 1,
            rows: [{
              workflow_id: 'workflow-1',
              stage_name: 'review',
              workflow_lifecycle: 'planned',
              stage_status: 'active',
              stage_gate_status: 'approved',
            }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workspaces p')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM tasks') && sql.includes('work_item_id = $3') && sql.includes('role = $4')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql === 'SELECT id FROM tasks WHERE tenant_id = $1 AND id = ANY($2::uuid[])') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('INSERT INTO tasks')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-review-1',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              state: 'ready',
            }],
          };
        }
        if (isPlaybookDefinitionLookup(sql)) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const service = new TaskWriteService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      config: { TASK_DEFAULT_TIMEOUT_MINUTES: 30 },
      hasOrchestratorPermission: vi.fn(async () => false),
      subtaskPermission: 'create_subtasks',
      loadTaskOrThrow: vi.fn(),
      toTaskResponse: (task) => task,
      parallelismService: {
        shouldQueueForCapacity: vi.fn(async () => false),
      } as never,
    });

    const result = await service.createTask(
      {
        tenantId: 'tenant-1',
        scope: 'admin',
        keyPrefix: 'admin-key',
      } as never,
      {
        title: 'Code Review: Audit Export Hang Fix',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        request_id: 'create-task-review-code-reviewer-1',
        role: 'Code Reviewer',
        stage_name: 'review',
      },
    );

    expect(result.state).toBe('ready');
  });

  it('returns recoverable guidance when a planned-workflow stage is already completed', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM tasks') && sql.includes('workflow_id = $2') && sql.includes('request_id = $3')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('LEFT JOIN workflow_stages ws')) {
          return {
            rowCount: 1,
            rows: [{
              workflow_id: 'workflow-1',
              stage_name: 'review',
              workflow_lifecycle: 'planned',
              stage_status: 'completed',
              stage_gate_status: 'approved',
            }],
          };
        }
        if (isPlaybookDefinitionLookup(sql)) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const service = new TaskWriteService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      config: { TASK_DEFAULT_TIMEOUT_MINUTES: 30 },
      hasOrchestratorPermission: vi.fn(async () => false),
      subtaskPermission: 'create_subtasks',
      loadTaskOrThrow: vi.fn(),
      toTaskResponse: (task) => task,
      parallelismService: {
        shouldQueueForCapacity: vi.fn(async () => false),
      } as never,
    });

    await expect(
      service.createTask(
        {
          tenantId: 'tenant-1',
          scope: 'admin',
          keyPrefix: 'admin-key',
        } as never,
        {
          title: 'Late review reroute',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          request_id: 'late-reroute-1',
          role: 'Code Reviewer',
          stage_name: 'review',
        },
      ),
    ).rejects.toMatchObject({
      details: expect.objectContaining({
        recovery_hint: 'orchestrator_guided_recovery',
        reason_code: 'planned_stage_already_completed',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        requested_role: 'Code Reviewer',
        linked_work_item_stage_name: 'review',
        requested_stage_name: 'review',
      }),
    });
  });
});
