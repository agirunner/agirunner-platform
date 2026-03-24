import { describe, expect, it, vi } from 'vitest';

import { ConflictError } from '../../src/errors/domain-errors.js';
import { TaskLifecycleService } from '../../src/services/task-lifecycle-service.js';

describe('TaskLifecycleService continuity hooks', () => {
  it('records continuity when requesting changes on a linked work item', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') {
          return { rows: [], rowCount: 0 };
        }
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-review-loop',
              state: 'ready',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              stage_name: 'implementation',
              role: 'developer',
              input: { assessment_feedback: 'Fix the failing assertions' },
              metadata: { assessment_action: 'request_changes' },
            }],
          };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    const workItemContinuityService = {
      recordAssessmentRequestedChanges: vi.fn(async () => null),
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-review-loop',
        state: 'output_pending_assessment',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        stage_name: 'implementation',
        role: 'developer',
        input: { summary: 'old output' },
        rework_count: 0,
        metadata: {},
      }),
      toTaskResponse: (task) => task,
      workItemContinuityService: workItemContinuityService as never,
    });

    await service.requestTaskChanges(
      {
        id: 'admin',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: null,
        keyPrefix: 'admin',
      },
      'task-review-loop',
      {
        feedback: 'Fix the failing assertions',
      },
    );

    expect(workItemContinuityService.recordAssessmentRequestedChanges).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        id: 'task-review-loop',
        work_item_id: 'work-item-1',
        stage_name: 'implementation',
        role: 'developer',
      }),
      client,
    );
  });

  it('clears continuity expectations when task output is approved', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') {
          return { rows: [], rowCount: 0 };
        }
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-output-approval',
              state: 'completed',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              stage_name: 'implementation',
              role: 'developer',
              output: { summary: 'done' },
              metadata: { assessment_action: 'approve_output' },
            }],
          };
        }
        if (
          sql.includes('UPDATE workflow_work_items')
          && sql.includes("parent_work_item_id = $3")
          && sql.includes("COALESCE(review_task.metadata->>'task_kind', '') = 'assessment'")
        ) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    const workItemContinuityService = {
      clearAssessmentExpectation: vi.fn(async () => null),
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-output-approval',
        state: 'output_pending_assessment',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        stage_name: 'implementation',
        role: 'developer',
        output: { summary: 'done' },
        metadata: {},
      }),
      toTaskResponse: (task) => task,
      workItemContinuityService: workItemContinuityService as never,
    });

    await service.approveTaskOutput(
      {
        id: 'admin',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: null,
        keyPrefix: 'admin',
      },
      'task-output-approval',
    );

    expect(workItemContinuityService.clearAssessmentExpectation).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        id: 'task-output-approval',
        work_item_id: 'work-item-1',
      }),
      client,
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("parent_work_item_id = $3"),
      ['tenant-1', 'workflow-1', 'work-item-1'],
    );
  });

  it('treats already-completed task output approval as idempotent', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const workItemContinuityService = {
      clearAssessmentExpectation: vi.fn(async () => null),
    };
    const completedTask = {
      id: 'task-output-approval-idempotent',
      state: 'completed',
      workflow_id: 'workflow-1',
      work_item_id: 'work-item-1',
      stage_name: 'implementation',
      role: 'developer',
      output: { summary: 'done' },
      metadata: {},
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue(completedTask),
      toTaskResponse: (task) => task,
      workItemContinuityService: workItemContinuityService as never,
    });

    const result = await service.approveTaskOutput(
      {
        id: 'admin',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: null,
        keyPrefix: 'admin',
      },
      'task-output-approval-idempotent',
    );

    expect(result).toEqual(completedTask);
    expect(client.query).not.toHaveBeenCalled();
    expect(workItemContinuityService.clearAssessmentExpectation).not.toHaveBeenCalled();
  });

  it('rejects agent-driven output approval for workflow specialist tasks', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-output-agent-blocked',
        state: 'output_pending_assessment',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        stage_name: 'implementation',
        role: 'developer',
        is_orchestrator_task: false,
        metadata: {},
      }),
      toTaskResponse: (task) => task,
      workItemContinuityService: { clearAssessmentExpectation: vi.fn() } as never,
    });

    await expect(
      service.approveTaskOutput(
        {
          id: 'agent-key',
          tenantId: 'tenant-1',
          scope: 'agent',
          ownerType: 'agent',
          ownerId: 'agent-1',
          keyPrefix: 'ak',
        },
        'task-output-agent-blocked',
      ),
    ).rejects.toThrowError(ConflictError);

    expect(client.query).not.toHaveBeenCalled();
  });
});
