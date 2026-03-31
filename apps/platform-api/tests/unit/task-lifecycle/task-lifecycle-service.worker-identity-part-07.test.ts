import { describe, expect, it, vi } from 'vitest';
import { ValidationError } from '../../../src/errors/domain-errors.js';
import { TaskLifecycleService } from '../../../src/services/task-lifecycle/task-lifecycle-service.js';
type TaskLifecycleDependencies = ConstructorParameters<typeof TaskLifecycleService>[0];
describe('TaskLifecycleService worker identity + payload semantics', () => {
  it('treats a repeated request-changes action as idempotent once active rework is already in progress', async () => {
    const client = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };
    const existingTask = {
      id: 'task-review-loop-active',
      state: 'in_progress',
      workflow_id: 'workflow-1',
      work_item_id: 'work-item-1',
      input: {
        assessment_feedback:
          'Review task 8bf issued a request-changes verdict. Add explicit short-form coverage and resubmit.',
      },
      metadata: {
        assessment_action: 'request_changes',
        assessment_feedback:
          'Review task 8bf issued a request-changes verdict. Add explicit short-form coverage and resubmit.',
      },
      rework_count: 1,
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue(existingTask),
      toTaskResponse: (task) => task,
    });

    const result = await service.requestTaskChanges(
      {
        id: 'admin',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: null,
        keyPrefix: 'admin',
      },
      'task-review-loop-active',
      {
        feedback:
          'Reviewer task 8bf completed with a partial request-changes verdict. Add explicit short-form coverage and resubmit.',
      },
    );

    expect(result).toEqual(existingTask);
    expect(client.query).not.toHaveBeenCalled();
  });


  it('does not reapply the same reviewer request-changes handoff after the developer resubmits output', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('WITH RECURSIVE descendant_work_items') && sql.includes("th.resolution = 'request_changes'")) {
          expect(sql).toContain("COALESCE(th.role_data->>'subject_work_item_id', '') = $3::text");
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'work-item-1',
            'task-review-loop-consumed',
          ]);
          return {
            rowCount: 1,
            rows: [{
              handoff_id: 'handoff-review-1',
              assessment_task_id: 'review-task-1',
              created_at: new Date('2026-03-21T16:52:24.000Z'),
            }],
          };
        }
        if (
          sql.includes('FROM task_handoffs')
          && sql.includes('task_id = $2')
          && sql.includes('task_rework_count = $3')
        ) {
          expect(params).toEqual(['tenant-1', 'task-review-loop-consumed', 1]);
          return {
            rowCount: 1,
            rows: [{
              created_at: new Date('2026-03-21T16:53:16.000Z'),
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const existingTask = {
      id: 'task-review-loop-consumed',
      state: 'output_pending_assessment',
      workflow_id: 'workflow-1',
      work_item_id: 'work-item-1',
      input: {
        assessment_feedback: 'Earlier review feedback',
      },
      metadata: {
        assessment_action: 'request_changes',
        assessment_feedback: 'Earlier review feedback',
        last_applied_assessment_request_handoff_id: 'handoff-review-1',
        last_applied_assessment_request_task_id: 'review-task-1',
      },
      rework_count: 1,
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue(existingTask),
      toTaskResponse: (task) => task,
    });

    const result = await service.requestTaskChanges(
      {
        id: 'admin',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: null,
        keyPrefix: 'admin',
      },
      'task-review-loop-consumed',
      {
        feedback: 'The same stale review verdict was replayed.',
      },
    );

    expect(result).toEqual(existingTask);
    expect(client.query).toHaveBeenCalledTimes(2);
  });


  it('ignores a stale request-changes replay once a newer developer handoff already exists', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('WITH RECURSIVE descendant_work_items') && sql.includes("th.resolution = 'request_changes'")) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'work-item-1',
            'task-review-loop-superseded',
          ]);
          return {
            rowCount: 1,
            rows: [{
              handoff_id: 'handoff-review-1',
              assessment_task_id: 'review-task-1',
              created_at: new Date('2026-03-21T16:52:24.000Z'),
            }],
          };
        }
        if (
          sql.includes('FROM task_handoffs')
          && sql.includes('task_id = $2')
          && sql.includes('task_rework_count = $3')
        ) {
          expect(params).toEqual(['tenant-1', 'task-review-loop-superseded', 1]);
          return {
            rowCount: 1,
            rows: [{
              created_at: new Date('2026-03-21T16:53:16.000Z'),
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const existingTask = {
      id: 'task-review-loop-superseded',
      state: 'output_pending_assessment',
      workflow_id: 'workflow-1',
      work_item_id: 'work-item-1',
      input: {
        assessment_feedback: 'Earlier review feedback',
      },
      metadata: {},
      rework_count: 1,
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue(existingTask),
      toTaskResponse: (task) => task,
    });

    const result = await service.requestTaskChanges(
      {
        id: 'admin',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: null,
        keyPrefix: 'admin',
      },
      'task-review-loop-superseded',
      {
        feedback: 'The same stale review verdict was replayed after a fresh developer submission.',
      },
    );

    expect(result).toEqual(existingTask);
    expect(client.query).toHaveBeenCalledTimes(2);
  });


  it('ignores a stale QA request-changes replay once a newer developer handoff already exists', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('WITH RECURSIVE descendant_work_items') && sql.includes("th.resolution = 'request_changes'")) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'implementation-item',
            'task-qa-rework-superseded',
          ]);
          return {
            rowCount: 1,
            rows: [{
              handoff_id: 'handoff-qa-1',
              assessment_task_id: 'task-qa-1',
              created_at: new Date('2026-03-21T20:09:52.000Z'),
            }],
          };
        }
        if (
          sql.includes('FROM task_handoffs')
          && sql.includes('task_id = $2')
          && sql.includes('task_rework_count = $3')
        ) {
          expect(params).toEqual(['tenant-1', 'task-qa-rework-superseded', 1]);
          return {
            rowCount: 1,
            rows: [{
              created_at: new Date('2026-03-21T20:11:09.000Z'),
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const existingTask = {
      id: 'task-qa-rework-superseded',
      state: 'output_pending_assessment',
      workflow_id: 'workflow-1',
      work_item_id: 'implementation-item',
      input: {
        assessment_feedback: 'Earlier QA feedback',
      },
      metadata: {},
      rework_count: 1,
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue(existingTask),
      toTaskResponse: (task) => task,
    });

    const result = await service.requestTaskChanges(
      {
        id: 'admin',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: null,
        keyPrefix: 'admin',
      },
      'task-qa-rework-superseded',
      {
        feedback: 'The same QA request-changes verdict was replayed after a fresh developer submission.',
      },
    );

    expect(result).toEqual(existingTask);
    expect(client.query).toHaveBeenCalledTimes(2);
  });


  it('does not reapply the same same-work-item assessment request after it was already applied', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('WITH RECURSIVE descendant_work_items') && sql.includes("th.resolution = 'request_changes'")) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'intake-item-1',
            'task-intake-subject',
          ]);
          return {
            rowCount: 1,
            rows: [{
              handoff_id: 'handoff-assessment-1',
              assessment_task_id: 'task-assessment-1',
              created_at: new Date('2026-03-23T00:19:38.000Z'),
            }],
          };
        }
        if (
          sql.includes('FROM task_handoffs')
          && sql.includes('task_id = $2')
          && sql.includes('task_rework_count = $3')
        ) {
          expect(params).toEqual(['tenant-1', 'task-intake-subject', 1]);
          return {
            rowCount: 0,
            rows: [],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const existingTask = {
      id: 'task-intake-subject',
      state: 'output_pending_assessment',
      workflow_id: 'workflow-1',
      work_item_id: 'intake-item-1',
      input: {
        assessment_feedback: 'Earlier assessment feedback',
      },
      metadata: {
        last_applied_assessment_request_handoff_id: 'handoff-assessment-1',
        last_applied_assessment_request_task_id: 'task-assessment-1',
      },
      rework_count: 1,
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue(existingTask),
      toTaskResponse: (task) => task,
    });

    const result = await service.requestTaskChanges(
      {
        id: 'admin',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: null,
        keyPrefix: 'admin',
      },
      'task-intake-subject',
      {
        feedback: 'The same assessment verdict was replayed on the linked subject task.',
      },
    );

    expect(result).toEqual(existingTask);
    expect(client.query).toHaveBeenCalledTimes(2);
  });


  it('treats a repeated reject action as idempotent once the task already reflects the rejection', async () => {
    const client = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };
    const existingTask = {
      id: 'task-review-rejected',
      state: 'failed',
      workflow_id: null,
      error: {
        category: 'assessment_rejected',
        message: 'Fix the failing assertions',
        recoverable: true,
      },
      metadata: {
        assessment_action: 'reject',
        assessment_feedback: 'Fix the failing assertions',
      },
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue(existingTask),
      toTaskResponse: (task) => task,
    });

    const result = await service.rejectTask(
      {
        id: 'admin',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: null,
        keyPrefix: 'admin',
      },
      'task-review-rejected',
      {
        feedback: 'Fix the failing assertions',
      },
    );

    expect(result).toEqual(existingTask);
    expect(client.query).not.toHaveBeenCalled();
  });
});
