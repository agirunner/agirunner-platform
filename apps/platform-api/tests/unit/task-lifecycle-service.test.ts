import { describe, expect, it, vi } from 'vitest';

import { ValidationError } from '../../src/errors/domain-errors.js';
import { TaskLifecycleService } from '../../src/services/task-lifecycle-service.js';

type TaskLifecycleDependencies = ConstructorParameters<typeof TaskLifecycleService>[0];

describe('TaskLifecycleService concurrent state guard (maintenance-sad cancellation race)', () => {
  it('prevents stale transitions from overwriting newer task state', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') {
          return { rows: [], rowCount: 0 };
        }

        if (sql.startsWith('UPDATE tasks SET')) {
          // Simulate optimistic-concurrency miss: row state changed after initial read.
          return { rows: [], rowCount: 0 };
        }

        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };

    const pool = {
      connect: vi.fn(async () => client),
    };

    const loadTaskOrThrow = vi
      .fn()
      // Guard read in startTask sees claimed state (not in_progress, so continues).
      .mockResolvedValueOnce({
        id: 'task-1',
        state: 'claimed',
        workflow_id: null,
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
      })
      // First read inside applyStateTransition sees claimed state.
      .mockResolvedValueOnce({
        id: 'task-1',
        state: 'claimed',
        workflow_id: null,
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
      })
      // Second read after update miss sees that cancellation won the race.
      .mockResolvedValueOnce({
        id: 'task-1',
        state: 'cancelled',
        workflow_id: null,
        assigned_agent_id: null,
        assigned_worker_id: null,
      });

    const eventService = { emit: vi.fn() };
    const workflowStateService = { recomputeWorkflowState: vi.fn() };

    const service = new TaskLifecycleService({
      pool: pool as never,
      eventService: eventService as never,
      workflowStateService: workflowStateService as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow,
      toTaskResponse: (task) => task,
    });

    const identity = {
      id: 'key-1',
      tenantId: 'tenant-1',
      scope: 'agent' as const,
      ownerType: 'agent',
      ownerId: 'agent-1',
      keyPrefix: 'agent-key',
    };

    await expect(service.startTask(identity, 'task-1', { agent_id: 'agent-1' })).rejects.toThrow(
      /INVALID_STATE_TRANSITION|Task state changed concurrently|Cannot transition from 'cancelled' to 'in_progress'/,
    );

    const updateCall = client.query.mock.calls.find(
      (call) => typeof call[0] === 'string' && (call[0] as string).startsWith('UPDATE tasks SET'),
    );

    expect(updateCall).toBeDefined();
    expect(updateCall?.[0]).toContain('state = ANY(');

    const updateParams =
      ((updateCall as unknown[] | undefined)?.[1] as unknown[] | undefined) ?? [];
    expect(updateParams[updateParams.length - 1]).toEqual(['claimed']);

    expect(eventService.emit).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });
});

describe('TaskLifecycleService worker identity + payload semantics', () => {
  it('allows worker identity to complete assigned in-progress task', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'task-worker',
                state: 'completed',
                workflow_id: null,
                assigned_agent_id: null,
                assigned_worker_id: null,
                metrics: { duration_seconds: 4 },
                git_info: { commit_hash: 'abc123' },
                metadata: { verification: { passed: true } },
              },
            ],
          };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };

    const pool = { connect: vi.fn(async () => client), query: client.query };

    const service = new TaskLifecycleService({
      pool: pool as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-worker',
        state: 'in_progress',
        workflow_id: null,
        assigned_agent_id: 'agent-1',
        assigned_worker_id: 'worker-1',
        role_config: {},
      }),
      toTaskResponse: (task) => task,
    });

    const result = await service.completeTask(
      {
        id: 'worker-key',
        tenantId: 'tenant-1',
        scope: 'worker',
        ownerType: 'worker',
        ownerId: 'worker-1',
        keyPrefix: 'wk',
      },
      'task-worker',
      {
        output: { ok: true },
        metrics: { duration_seconds: 4 },
        git_info: { commit_hash: 'abc123' },
        verification: { passed: true },
      },
    );

    expect(result.state).toBe('completed');
    expect(result.metrics).toMatchObject({ duration_seconds: 4 });
  });

  it('moves completion to output_pending_review when output schema validation fails', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'task-review',
                state: 'output_pending_review',
                workflow_id: 'wf-1',
                assigned_agent_id: null,
                assigned_worker_id: null,
                output: { missing: true },
                metadata: { verification: { passed: true } },
              },
            ],
          };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-review',
        state: 'in_progress',
        workflow_id: null,
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        role_config: {
          output_schema: {
            type: 'object',
            required: ['summary'],
            properties: { summary: { type: 'string' } },
          },
        },
      }),
      toTaskResponse: (task) => task,
    });

    const result = await service.completeTask(
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'ak',
      },
      'task-review',
      {
        output: { missing: true },
        verification: { passed: true },
      },
    );

    expect(result.state).toBe('output_pending_review');
  });

  it('records continuity expectations when completion routes to output review', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') {
          return { rows: [], rowCount: 0 };
        }
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-review-needed',
              state: 'output_pending_review',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              stage_name: 'implementation',
              role: 'developer',
              output: { summary: 'ready for review' },
              metadata: {},
            }],
          };
        }
        if (sql === 'SELECT playbook_id FROM workflows WHERE tenant_id = $1 AND id = $2') {
          return { rows: [{ playbook_id: 'playbook-1' }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO workflow_activations')) {
          return {
            rows: [{
              id: 'activation-review-needed',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'task-output_pending_review:task-review-needed:updated',
              reason: 'task.output_pending_review',
              event_type: 'task.output_pending_review',
              payload: {},
              state: 'queued',
              dispatch_attempt: 0,
              dispatch_token: null,
              queued_at: new Date(),
              started_at: null,
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    const workItemContinuityService = {
      recordTaskCompleted: vi.fn(async () => ({
        matchedRuleType: 'review',
        nextExpectedActor: 'reviewer',
        nextExpectedAction: 'review',
        requiresHumanApproval: false,
        reworkDelta: 0,
        satisfiedReviewExpectation: false,
      })),
    };
    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-review-needed',
        state: 'in_progress',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        stage_name: 'implementation',
        role: 'developer',
        requires_output_review: true,
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        role_config: {},
      }),
      toTaskResponse: (task) => task,
      workItemContinuityService: workItemContinuityService as never,
    });

    const result = await service.completeTask(
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'ak',
      },
      'task-review-needed',
      {
        output: { summary: 'ready for review' },
        verification: { passed: true },
      },
    );

    expect(result.state).toBe('output_pending_review');
    expect(workItemContinuityService.recordTaskCompleted).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        id: 'task-review-needed',
        state: 'output_pending_review',
        work_item_id: 'work-item-1',
        role: 'developer',
      }),
      client,
    );
  });

  it('completes reviewer tasks immediately when the structured handoff approves the review outcome', async () => {
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('FROM task_handoffs')) {
          expect(values).toEqual(['tenant-1', 'task-reviewer-approved', 0]);
          return {
            rows: [{ review_outcome: 'approved' }],
            rowCount: 1,
          };
        }
        if (sql.startsWith('UPDATE tasks SET')) {
          expect(values?.[2]).toBe('completed');
          return {
            rowCount: 1,
            rows: [
              {
                id: 'task-reviewer-approved',
                state: 'completed',
                workflow_id: 'workflow-1',
                work_item_id: 'work-item-1',
                stage_name: 'implementation',
                role: 'reviewer',
                output: { review_outcome: 'approved' },
                metadata: {},
              },
            ],
          };
        }
        if (sql === 'SELECT playbook_id FROM workflows WHERE tenant_id = $1 AND id = $2') {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    const handoffService = {
      assertRequiredTaskHandoffBeforeCompletion: vi.fn(async () => undefined),
    };
    const pool = {
      connect: vi.fn(async () => client),
      query: client.query,
    };

    const service = new TaskLifecycleService({
      pool: pool as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-reviewer-approved',
        state: 'in_progress',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        stage_name: 'implementation',
        role: 'reviewer',
        requires_output_review: true,
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        rework_count: 0,
        role_config: {},
      }),
      toTaskResponse: (task) => task,
      handoffService: handoffService as never,
    });

    const result = await service.completeTask(
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'ak',
      },
      'task-reviewer-approved',
      {
        output: { review_outcome: 'approved' },
        verification: { passed: true },
      },
    );

    expect(result.state).toBe('completed');
  });

  it('fails completion before state transition when a required handoff is missing', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          throw new Error('should not update task state when handoff is missing');
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    const handoffService = {
      assertRequiredTaskHandoffBeforeCompletion: vi.fn(async () => {
        throw new ValidationError('Task requires a structured handoff before completion');
      }),
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-needs-handoff',
        state: 'in_progress',
        workflow_id: 'workflow-1',
        role: 'developer',
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        role_config: {},
      }),
      toTaskResponse: (task) => task,
      handoffService: handoffService as never,
    });

    await expect(
      service.completeTask(
        {
          id: 'agent-key',
          tenantId: 'tenant-1',
          scope: 'agent',
          ownerType: 'agent',
          ownerId: 'agent-1',
          keyPrefix: 'ak',
        },
        'task-needs-handoff',
        {
          output: { ok: true },
          verification: { passed: true },
        },
      ),
    ).rejects.toThrow('Task requires a structured handoff before completion');

    expect(handoffService.assertRequiredTaskHandoffBeforeCompletion).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        id: 'task-needs-handoff',
        workflow_id: 'workflow-1',
        role: 'developer',
      }),
      undefined,
    );
  });

  it('queues cancel signal for in-progress worker task before cancellation transition', async () => {
    const queueWorkerCancelSignal = vi.fn(async () => 'signal-1');

    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'task-cancel',
                state: 'cancelled',
                assigned_agent_id: null,
                assigned_worker_id: null,
                workflow_id: null,
              },
            ],
          };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-cancel',
        state: 'in_progress',
        assigned_worker_id: 'worker-1',
      }),
      toTaskResponse: (task) => task,
      queueWorkerCancelSignal,
    });

    const result = await service.cancelTask(
      {
        id: 'admin',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: null,
        keyPrefix: 'admin',
      },
      'task-cancel',
    );

    expect(result.state).toBe('cancelled');
    expect(queueWorkerCancelSignal).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'worker-1',
      'task-cancel',
      'manual_cancel',
      expect.any(Date),
    );
  });

  it('treats a repeated task cancellation as idempotent once the task is already cancelled', async () => {
    const queueWorkerCancelSignal = vi.fn(async () => 'signal-1');
    const client = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };
    const existingTask = {
      id: 'task-cancel',
      state: 'cancelled',
      assigned_agent_id: null,
      assigned_worker_id: null,
      workflow_id: null,
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue(existingTask),
      toTaskResponse: (task) => task,
      queueWorkerCancelSignal,
    });

    const result = await service.cancelTask(
      {
        id: 'admin',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: null,
        keyPrefix: 'admin',
      },
      'task-cancel',
    );

    expect(result).toEqual(existingTask);
    expect(queueWorkerCancelSignal).not.toHaveBeenCalled();
    expect(client.query).not.toHaveBeenCalled();
  });

  it('treats a repeated approval as idempotent once parallelism has already queued the approved task in pending', async () => {
    const client = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };
    const existingTask = {
      id: 'task-approve',
      state: 'pending',
      workflow_id: 'workflow-1',
      metadata: {
        review_action: 'approve',
      },
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue(existingTask),
      toTaskResponse: (task) => task,
      parallelismService: { shouldQueueForCapacity: vi.fn(), releaseQueuedReadyTasks: vi.fn() } as never,
    });

    const result = await service.approveTask(
      {
        id: 'admin',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: null,
        keyPrefix: 'admin',
      },
      'task-approve',
    );

    expect(result).toEqual(existingTask);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('records review metadata when requesting task changes', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'task-review-loop',
                state: 'ready',
                workflow_id: null,
                input: { review_feedback: 'Fix the failing assertions' },
                metadata: { review_action: 'request_changes', preferred_agent_id: 'agent-2' },
              },
            ],
          };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-review-loop',
        state: 'output_pending_review',
        workflow_id: null,
        input: { summary: 'old output' },
        rework_count: 0,
        metadata: {},
      }),
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
      'task-review-loop',
      {
        feedback: 'Fix the failing assertions',
        preferred_agent_id: 'agent-2',
      },
    );

    expect(result.state).toBe('ready');
    expect(result.input).toMatchObject({ review_feedback: 'Fix the failing assertions' });
    expect(result.metadata).toMatchObject({
      review_action: 'request_changes',
      preferred_agent_id: 'agent-2',
    });
    const updateCall = client.query.mock.calls.find(([sql]) => typeof sql === 'string' && sql.startsWith('UPDATE tasks SET')) as
      | [string, unknown[]]
      | undefined;
    expect(updateCall?.[1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ review_feedback: 'Fix the failing assertions' }),
        expect.objectContaining({ review_action: 'request_changes', preferred_agent_id: 'agent-2' }),
      ]),
    );
  });

  it('treats a repeated request-changes action as idempotent once the task already reflects it', async () => {
    const client = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };
    const existingTask = {
      id: 'task-review-loop',
      state: 'ready',
      workflow_id: null,
      input: { review_feedback: 'Fix the failing assertions' },
      metadata: {
        review_action: 'request_changes',
        review_feedback: 'Fix the failing assertions',
        preferred_agent_id: 'agent-2',
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

    const result = await service.requestTaskChanges(
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
        preferred_agent_id: 'agent-2',
      },
    );

    expect(result).toEqual(existingTask);
    expect(client.query).not.toHaveBeenCalled();
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
        category: 'review_rejected',
        message: 'Fix the failing assertions',
        recoverable: true,
      },
      metadata: {
        review_action: 'reject',
        review_feedback: 'Fix the failing assertions',
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

  it('fails and escalates when request-changes exceeds the configured max rework count', async () => {
    const eventService = { emit: vi.fn() };
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'task-max-rework',
                state: 'failed',
                workflow_id: 'pipe-1',
                title: 'Compile',
                role: 'builder',
                timeout_minutes: 15,
                rework_count: 3,
                metadata: {
                  lifecycle_policy: {
                    rework: { max_cycles: 2 },
                    escalation: {
                      enabled: true,
                      role: 'orchestrator',

                      title_template: 'Escalation: {{task_title}}',
                    },
                  },
                },
              },
            ],
          };
        }
        if (sql.startsWith('INSERT INTO tasks')) {
          return {
            rowCount: 1,
            rows: [{ id: 'escalation-2' }],
          };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: eventService as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-max-rework',
        state: 'output_pending_review',
        workflow_id: 'pipe-1',
        title: 'Compile',
        role: 'builder',
        timeout_minutes: 15,
        rework_count: 2,
        input: {},
        metadata: {
          lifecycle_policy: {
            rework: { max_cycles: 2 },
            escalation: {
              enabled: true,
              role: 'orchestrator',
              title_template: 'Escalation: {{task_title}}',
            },
          },
        },
      }),
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
      'task-max-rework',
      {
        feedback: 'Still broken',
      },
    );

    expect(result.state).toBe('failed');
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'task.max_rework_exceeded' }),
      expect.anything(),
    );
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'task.escalation' }),
      expect.anything(),
    );
  });

  it('queues cancel signal before reassigning an in-progress task', async () => {
    const queueWorkerCancelSignal = vi.fn(async () => 'signal-2');
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'task-reassign',
                state: 'ready',
                workflow_id: null,
                metadata: { preferred_worker_id: 'worker-3', review_action: 'reassign' },
              },
            ],
          };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-reassign',
        state: 'in_progress',
        workflow_id: null,
        assigned_worker_id: 'worker-2',
        metadata: {},
      }),
      toTaskResponse: (task) => task,
      queueWorkerCancelSignal,
    });

    const result = await service.reassignTask(
      {
        id: 'admin',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: null,
        keyPrefix: 'admin',
      },
      'task-reassign',
      {
        preferred_worker_id: 'worker-3',
        reason: 'Move to a healthier worker',
      },
    );

    expect(result.state).toBe('ready');
    expect(result.metadata).toMatchObject({
      preferred_worker_id: 'worker-3',
      review_action: 'reassign',
    });
    expect(queueWorkerCancelSignal).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'worker-2',
      'task-reassign',
      'manual_cancel',
      expect.any(Date),
    );
    const updateCall = client.query.mock.calls.find(([sql]) => typeof sql === 'string' && sql.startsWith('UPDATE tasks SET')) as
      | [string, unknown[]]
      | undefined;
    expect(updateCall?.[1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ preferred_worker_id: 'worker-3', review_action: 'reassign' }),
      ]),
    );
  });

  it('treats a repeated reassign action as idempotent once the task already reflects it', async () => {
    const queueWorkerCancelSignal = vi.fn(async () => 'signal-2');
    const client = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };
    const existingTask = {
      id: 'task-reassign',
      state: 'ready',
      workflow_id: null,
      metadata: {
        preferred_worker_id: 'worker-3',
        review_action: 'reassign',
        review_feedback: 'Move to a healthier worker',
      },
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue(existingTask),
      toTaskResponse: (task) => task,
      queueWorkerCancelSignal,
    });

    const result = await service.reassignTask(
      {
        id: 'admin',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: null,
        keyPrefix: 'admin',
      },
      'task-reassign',
      {
        preferred_worker_id: 'worker-3',
        reason: 'Move to a healthier worker',
      },
    );

    expect(result).toEqual(existingTask);
    expect(queueWorkerCancelSignal).not.toHaveBeenCalled();
    expect(client.query).not.toHaveBeenCalled();
  });

  it('treats a repeated reassign action as idempotent when the requested reassignment is already pending behind parallelism', async () => {
    const queueWorkerCancelSignal = vi.fn(async () => 'signal-2');
    const client = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };
    const existingTask = {
      id: 'task-reassign',
      state: 'pending',
      workflow_id: 'workflow-1',
      metadata: {
        preferred_worker_id: 'worker-3',
        review_action: 'reassign',
        review_feedback: 'Move to a healthier worker',
      },
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue(existingTask),
      toTaskResponse: (task) => task,
      queueWorkerCancelSignal,
    });

    const result = await service.reassignTask(
      {
        id: 'admin',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: null,
        keyPrefix: 'admin',
      },
      'task-reassign',
      {
        preferred_worker_id: 'worker-3',
        reason: 'Move to a healthier worker',
      },
    );

    expect(result).toEqual(existingTask);
    expect(queueWorkerCancelSignal).not.toHaveBeenCalled();
    expect(client.query).not.toHaveBeenCalled();
  });

  it('schedules retry with backoff when lifecycle retry policy marks the failure retryable', async () => {
    const eventService = { emit: vi.fn() };
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'task-retry-policy',
                state: 'pending',
                workflow_id: null,
                retry_count: 1,
                metadata: {
                  retry_backoff_seconds: 5,
                },
              },
            ],
          };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: eventService as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-retry-policy',
        state: 'in_progress',
        workflow_id: null,
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        retry_count: 0,
        metadata: {
          lifecycle_policy: {
            retry_policy: {
              max_attempts: 2,
              backoff_strategy: 'fixed',
              initial_backoff_seconds: 5,
              retryable_categories: ['timeout'],
            },
          },
        },
      }),
      toTaskResponse: (task) => task,
    });

    const result = await service.failTask(
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'ak',
      },
      'task-retry-policy',
      {
        error: { category: 'timeout', message: 'too slow' },
      },
    );

    expect(result.state).toBe('pending');
    expect(result.retry_count).toBe(1);
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'task.retry_scheduled' }),
      expect.anything(),
    );
  });

  it('releases queued specialist tasks when auto-retry backoff moves an active task to pending', async () => {
    const eventService = { emit: vi.fn() };
    const parallelismService = {
      releaseQueuedReadyTasks: vi.fn(async () => 1),
    };
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'task-retry-release',
                state: 'pending',
                workflow_id: 'wf-1',
                is_orchestrator_task: false,
                retry_count: 1,
                metadata: {
                  retry_backoff_seconds: 5,
                },
              },
            ],
          };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };

    const workflowStateService = { recomputeWorkflowState: vi.fn() };
    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: eventService as never,
      workflowStateService: workflowStateService as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-retry-release',
        state: 'in_progress',
        workflow_id: 'wf-1',
        is_orchestrator_task: false,
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        retry_count: 0,
        metadata: {
          lifecycle_policy: {
            retry_policy: {
              max_attempts: 2,
              backoff_strategy: 'fixed',
              initial_backoff_seconds: 5,
              retryable_categories: ['timeout'],
            },
          },
        },
      }),
      toTaskResponse: (task) => task,
      parallelismService: parallelismService as never,
    });

    const result = await service.failTask(
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'ak',
      },
      'task-retry-release',
      {
        error: { category: 'timeout', message: 'too slow' },
      },
    );

    expect(result.state).toBe('pending');
    expect(parallelismService.releaseQueuedReadyTasks).toHaveBeenCalledWith(
      eventService,
      'tenant-1',
      'wf-1',
      client,
    );
  });

  it('respects parallelism caps when a manual retry would reopen a failed task', async () => {
    const eventService = { emit: vi.fn() };
    const parallelismService = {
      shouldQueueForCapacity: vi.fn(async () => true),
      releaseQueuedReadyTasks: vi.fn(async () => 0),
    };
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'task-manual-retry',
                state: 'pending',
                workflow_id: 'wf-1',
                work_item_id: 'wi-1',
                is_orchestrator_task: false,
                retry_count: 2,
                metadata: {},
              },
            ],
          };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: eventService as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-manual-retry',
        state: 'failed',
        workflow_id: 'wf-1',
        work_item_id: 'wi-1',
        is_orchestrator_task: false,
        assigned_agent_id: null,
        assigned_worker_id: null,
        retry_count: 1,
        metadata: {},
      }),
      toTaskResponse: (task) => task,
      parallelismService: parallelismService as never,
    });

    const result = await service.retryTask(
      {
        id: 'admin-key',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'tenant',
        ownerId: 'tenant-1',
        keyPrefix: 'admin',
      },
      'task-manual-retry',
    );

    expect(result.state).toBe('pending');
    expect(parallelismService.shouldQueueForCapacity).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        taskId: 'task-manual-retry',
        workflowId: 'wf-1',
        workItemId: 'wi-1',
        currentState: 'failed',
      }),
      client,
    );
    expect(parallelismService.releaseQueuedReadyTasks).not.toHaveBeenCalled();
  });

  it('lets a failed task retry reclaim a younger ready slot and reopen immediately', async () => {
    const eventService = { emit: vi.fn() };
    const parallelismService = {
      shouldQueueForCapacity: vi.fn(async () => true),
      reclaimReadySlotForTask: vi.fn(async () => true),
      releaseQueuedReadyTasks: vi.fn(async () => 0),
    };
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') {
          return { rows: [], rowCount: 0 };
        }
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'task-manual-retry-ready',
                state: 'ready',
                workflow_id: 'wf-1',
                work_item_id: 'wi-b',
                is_orchestrator_task: false,
                retry_count: 2,
                metadata: {},
              },
            ],
          };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: eventService as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-manual-retry-ready',
        state: 'failed',
        workflow_id: 'wf-1',
        work_item_id: 'wi-b',
        is_orchestrator_task: false,
        assigned_agent_id: null,
        assigned_worker_id: null,
        retry_count: 1,
        metadata: {},
      }),
      toTaskResponse: (task) => task,
      parallelismService: parallelismService as never,
    });

    const result = await service.retryTask(
      {
        id: 'admin-key',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'tenant',
        ownerId: 'tenant-1',
        keyPrefix: 'admin',
      },
      'task-manual-retry-ready',
    );

    expect(result.state).toBe('ready');
    expect(parallelismService.reclaimReadySlotForTask).toHaveBeenCalledWith(
      eventService,
      'tenant-1',
      expect.objectContaining({
        taskId: 'task-manual-retry-ready',
        workflowId: 'wf-1',
        workItemId: 'wi-b',
        currentState: 'failed',
      }),
      client,
    );
    expect(parallelismService.releaseQueuedReadyTasks).not.toHaveBeenCalled();
  });

  it('treats a repeated retry as idempotent once the task has already been reopened', async () => {
    const client = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };
    const existingTask = {
      id: 'task-manual-retry',
      state: 'ready',
      workflow_id: 'wf-1',
      work_item_id: 'wi-1',
      assigned_agent_id: null,
      assigned_worker_id: null,
      retry_count: 2,
      metadata: {},
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue(existingTask),
      toTaskResponse: (task) => task,
    });

    const result = await service.retryTask(
      {
        id: 'admin-key',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'tenant',
        ownerId: 'tenant-1',
        keyPrefix: 'admin',
      },
      'task-manual-retry',
    );

    expect(result).toEqual(existingTask);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('releases queued specialist tasks when an approval-gated task is cancelled', async () => {
    const eventService = { emit: vi.fn() };
    const parallelismService = {
      releaseQueuedReadyTasks: vi.fn(async () => 1),
    };
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'task-awaiting-approval',
                state: 'cancelled',
                workflow_id: 'wf-1',
                is_orchestrator_task: false,
                assigned_agent_id: null,
                assigned_worker_id: null,
                metadata: {},
              },
            ],
          };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: eventService as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-awaiting-approval',
        state: 'awaiting_approval',
        workflow_id: 'wf-1',
        is_orchestrator_task: false,
        assigned_agent_id: null,
        assigned_worker_id: null,
        metadata: {},
      }),
      toTaskResponse: (task) => task,
      parallelismService: parallelismService as never,
    });

    const result = await service.cancelTask(
      {
        id: 'admin-key',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'tenant',
        ownerId: 'tenant-1',
        keyPrefix: 'admin',
      },
      'task-awaiting-approval',
    );

    expect(result.state).toBe('cancelled');
    expect(parallelismService.releaseQueuedReadyTasks).toHaveBeenCalledWith(
      eventService,
      'tenant-1',
      'wf-1',
      client,
    );
  });

  it('creates an inline escalation task when lifecycle escalation policy is enabled', async () => {
    const eventService = { emit: vi.fn() };
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'task-escalate',
                state: 'failed',
                workflow_id: 'pipe-1',
                title: 'Compile',
                role: 'builder',
                timeout_minutes: 20,
                retry_count: 1,
                error: { category: 'validation_error', message: 'bad input' },
                metadata: {
                  lifecycle_policy: {
                    escalation: {
                      enabled: true,
                      role: 'orchestrator',

                      title_template: 'Escalation: {{task_title}}',
                    },
                  },
                },
              },
            ],
          };
        }
        if (sql.startsWith('INSERT INTO tasks')) {
          return {
            rowCount: 1,
            rows: [{ id: 'escalation-1' }],
          };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: eventService as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-escalate',
        state: 'in_progress',
        workflow_id: 'pipe-1',
        project_id: null,
        title: 'Compile',
        role: 'builder',
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        timeout_minutes: 20,
        retry_count: 1,
        metadata: {
          lifecycle_policy: {
            escalation: {
              enabled: true,
              role: 'orchestrator',
              title_template: 'Escalation: {{task_title}}',
            },
          },
        },
      }),
      toTaskResponse: (task) => task,
    });

    await service.failTask(
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'ak',
      },
      'task-escalate',
      {
        error: { category: 'validation_error', message: 'bad input', recoverable: false },
      },
    );

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO tasks'),
      expect.arrayContaining(['Escalation: Compile', 'orchestrator']),
    );
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'task.escalated' }),
      expect.anything(),
    );
  });

  it('queues lifecycle escalation tasks in pending when playbook parallelism is full', async () => {
    const eventService = { emit: vi.fn() };
    const parallelismService = {
      shouldQueueForCapacity: vi.fn(async () => true),
      releaseQueuedReadyTasks: vi.fn(async () => 1),
    };
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'task-escalate-pending',
                state: 'failed',
                workflow_id: 'pipe-1',
                work_item_id: 'wi-1',
                stage_name: 'build',
                title: 'Compile',
                role: 'builder',
                timeout_minutes: 20,
                retry_count: 1,
                error: { category: 'validation_error', message: 'bad input' },
                metadata: {
                  lifecycle_policy: {
                    escalation: {
                      enabled: true,
                      role: 'orchestrator',
                      title_template: 'Escalation: {{task_title}}',
                    },
                  },
                },
              },
            ],
          };
        }
        if (sql.startsWith('INSERT INTO tasks')) {
          expect(values).toEqual(expect.arrayContaining(['wi-1', 'build', 'pending']));
          return {
            rowCount: 1,
            rows: [{ id: 'escalation-queued' }],
          };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: eventService as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-escalate-pending',
        state: 'in_progress',
        workflow_id: 'pipe-1',
        work_item_id: 'wi-1',
        stage_name: 'build',
        project_id: null,
        title: 'Compile',
        role: 'builder',
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        timeout_minutes: 20,
        retry_count: 1,
        metadata: {
          lifecycle_policy: {
            escalation: {
              enabled: true,
              role: 'orchestrator',
              title_template: 'Escalation: {{task_title}}',
            },
          },
        },
      }),
      toTaskResponse: (task) => task,
      parallelismService: parallelismService as never,
    });

    await service.failTask(
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'ak',
      },
      'task-escalate-pending',
      {
        error: { category: 'validation_error', message: 'bad input', recoverable: false },
      },
    );

    expect(parallelismService.shouldQueueForCapacity).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        workflowId: 'pipe-1',
        workItemId: 'wi-1',
        currentState: null,
      }),
      client,
    );
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.created',
        entityId: 'escalation-queued',
        data: expect.objectContaining({ state: 'pending' }),
      }),
      client,
    );
  });

  it('moves a manually escalated task into escalated state and records operator guidance metadata', async () => {
    const eventService = { emit: vi.fn() };
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'task-manual-escalate',
                state: 'escalated',
                workflow_id: null,
                assigned_agent_id: null,
                assigned_worker_id: null,
                metadata: {
                  escalation_reason: 'Need operator guidance',
                  escalation_target: 'human',
                  escalation_context_packet: {
                    summary: 'The task is blocked on a product decision.',
                    artifact_id: 'artifact-1',
                  },
                  escalation_recommendation: 'Approve the staged rollout plan.',
                  escalation_blocking_task_id: '11111111-1111-1111-1111-111111111111',
                  escalation_urgency: 'important',
                  escalation_awaiting_human: true,
                  review_action: 'escalate',
                  review_feedback: 'Need operator guidance',
                },
              },
            ],
          };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: eventService as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-manual-escalate',
        state: 'in_progress',
        workflow_id: null,
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        role: 'developer',
        title: 'Needs help',
        metadata: {},
      }),
      toTaskResponse: (task) => task,
    });

    const result = await service.escalateTask(
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'ak',
      },
      'task-manual-escalate',
      {
        reason: 'Need operator guidance',
        context: {
          summary: 'The task is blocked on a product decision.',
          artifact_id: 'artifact-1',
        },
        recommendation: 'Approve the staged rollout plan.',
        blocking_task_id: '11111111-1111-1111-1111-111111111111',
        urgency: 'important',
      },
    );

    expect(result.state).toBe('escalated');
    expect(result.metadata).toMatchObject({
      escalation_reason: 'Need operator guidance',
      escalation_target: 'human',
      escalation_context_packet: {
        summary: 'The task is blocked on a product decision.',
        artifact_id: 'artifact-1',
      },
      escalation_recommendation: 'Approve the staged rollout plan.',
      escalation_blocking_task_id: '11111111-1111-1111-1111-111111111111',
      escalation_urgency: 'important',
      escalation_awaiting_human: true,
      review_action: 'escalate',
      review_feedback: 'Need operator guidance',
    });
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.escalated',
        data: expect.objectContaining({
          context: {
            summary: 'The task is blocked on a product decision.',
            artifact_id: 'artifact-1',
          },
          recommendation: 'Approve the staged rollout plan.',
          blocking_task_id: '11111111-1111-1111-1111-111111111111',
          urgency: 'important',
        }),
      }),
      expect.anything(),
    );
  });

  it('queues role-based escalation tasks in pending and preserves work-item scope when caps are full', async () => {
    const eventService = { emit: vi.fn() };
    const parallelismService = {
      shouldQueueForCapacity: vi.fn(async () => true),
      releaseQueuedReadyTasks: vi.fn(async () => 1),
    };
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          if (sql.includes('metadata = metadata || $3::jsonb')) {
            return { rowCount: 1, rows: [] };
          }
          return {
            rowCount: 1,
            rows: [
              {
                id: 'task-role-escalate',
                state: 'escalated',
                workflow_id: 'wf-1',
                work_item_id: 'wi-role',
                stage_name: 'build',
                project_id: null,
                assigned_agent_id: null,
                assigned_worker_id: null,
                role: 'developer',
                title: 'Implement fix',
                metadata: {
                  escalation_reason: 'Need reviewer help',
                  escalation_target: 'reviewer',
                },
              },
            ],
          };
        }
        if (sql.startsWith('INSERT INTO tasks')) {
          expect(values).toEqual(expect.arrayContaining(['wi-role', 'build', 'pending']));
          return {
            rowCount: 1,
            rows: [{ id: 'role-escalation-task' }],
          };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: eventService as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-role-escalate',
        state: 'in_progress',
        workflow_id: 'wf-1',
        work_item_id: 'wi-role',
        stage_name: 'build',
        project_id: null,
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        role: 'developer',
        title: 'Implement fix',
        input: { instructions: 'fix it' },
        metadata: {},
      }),
      toTaskResponse: (task) => task,
      getRoleByName: vi.fn(async () => ({
        escalation_target: 'reviewer',
        max_escalation_depth: 2,
      })),
      parallelismService: parallelismService as never,
    });

    await service.agentEscalate(
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'ak',
      },
      'task-role-escalate',
      {
        reason: 'Need reviewer help',
        context_summary: 'Waiting on a reviewer decision',
      },
    );

    expect(parallelismService.shouldQueueForCapacity).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        workflowId: 'wf-1',
        workItemId: 'wi-role',
        currentState: null,
      }),
      client,
    );
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.created',
        entityId: 'role-escalation-task',
        data: expect.objectContaining({ state: 'pending' }),
      }),
      client,
    );
  });

  it('treats a repeated manual escalation as idempotent once the task already reflects it', async () => {
    const client = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };
    const existingTask = {
      id: 'task-manual-escalate',
      state: 'escalated',
      metadata: {
        escalations: [
          {
            reason: 'Need operator guidance',
            target: null,
            context: { summary: 'Blocked on a product decision.' },
            recommendation: 'Approve the rollout.',
            blocking_task_id: '11111111-1111-1111-1111-111111111111',
            urgency: 'critical',
            escalated_at: '2026-03-12T00:00:00.000Z',
          },
        ],
        escalation_context_packet: { summary: 'Blocked on a product decision.' },
        escalation_recommendation: 'Approve the rollout.',
        escalation_blocking_task_id: '11111111-1111-1111-1111-111111111111',
        escalation_urgency: 'critical',
        review_action: 'escalate',
        review_feedback: 'Need operator guidance',
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

    const result = await service.escalateTask(
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'ak',
      },
      'task-manual-escalate',
      {
        reason: 'Need operator guidance',
        context: { summary: 'Blocked on a product decision.' },
        recommendation: 'Approve the rollout.',
        blocking_task_id: '11111111-1111-1111-1111-111111111111',
        urgency: 'critical',
      },
    );

    expect(result).toEqual(existingTask);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('treats a repeated agent escalation to another role as idempotent once the task already reflects it', async () => {
    const client = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };
    const existingTask = {
      id: 'task-agent-escalate-existing',
      state: 'escalated',
      role: 'developer',
      metadata: {
        escalation_reason: 'Need reviewer help',
        escalation_context: 'Waiting on a reviewer decision',
        escalation_work_so_far: 'Collected failing traces and current implementation notes.',
        escalation_target: 'reviewer',
        escalation_task_id: 'task-escalation-reviewer-1',
        escalation_depth: 1,
      },
      error: null,
    };
    const eventService = { emit: vi.fn() };
    const pool = { connect: vi.fn(async () => client) };
    const service = new TaskLifecycleService({
      pool: pool as never,
      eventService: eventService as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue(existingTask),
      toTaskResponse: (task) => task,
      getRoleByName: vi.fn(async () => ({
        escalation_target: 'reviewer',
        max_escalation_depth: 3,
      })),
    });

    const result = await service.agentEscalate(
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'ak',
      },
      'task-agent-escalate-existing',
      {
        reason: 'Need reviewer help',
        context_summary: 'Waiting on a reviewer decision',
        work_so_far: 'Collected failing traces and current implementation notes.',
      },
    );

    expect(result).toEqual(existingTask);
    expect(pool.connect).not.toHaveBeenCalled();
    expect(eventService.emit).not.toHaveBeenCalled();
  });

  it('treats a repeated depth-exceeded agent escalation as idempotent once the task already failed', async () => {
    const client = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };
    const existingTask = {
      id: 'task-agent-escalate-depth',
      state: 'failed',
      role: 'developer',
      metadata: {
        escalation_depth: 2,
        escalation_max_depth: 2,
      },
      error: {
        category: 'escalation_depth_exceeded',
        message: 'Escalation depth 2 exceeds maximum 2',
        recoverable: false,
      },
    };
    const eventService = { emit: vi.fn() };
    const pool = { connect: vi.fn(async () => client) };
    const service = new TaskLifecycleService({
      pool: pool as never,
      eventService: eventService as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue(existingTask),
      toTaskResponse: (task) => task,
      getRoleByName: vi.fn(async () => ({
        escalation_target: 'reviewer',
        max_escalation_depth: 2,
      })),
    });

    const result = await service.agentEscalate(
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'ak',
      },
      'task-agent-escalate-depth',
      {
        reason: 'Need reviewer help',
        context_summary: 'Blocked on escalation policy.',
      },
    );

    expect(result).toEqual(existingTask);
    expect(pool.connect).not.toHaveBeenCalled();
    expect(eventService.emit).not.toHaveBeenCalled();
  });

  it('records structured human escalation input onto the escalation task', async () => {
    const loadTaskOrThrow = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'source-task',
        metadata: { escalation_task_id: 'escalation-task' },
      })
      .mockResolvedValueOnce({
        id: 'escalation-task',
        input: { source_task_id: 'source-task' },
        metadata: {},
      })
      .mockResolvedValueOnce({
        id: 'escalation-task',
        input: {
          source_task_id: 'source-task',
          human_escalation_response: { instructions: 'Need a product decision' },
        },
        metadata: {},
      });

    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 1 };
      }),
      release: vi.fn(),
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow,
      toTaskResponse: (task) => task,
    });

    const result = await service.respondToEscalation(
      {
        id: 'admin',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: null,
        keyPrefix: 'admin',
      },
      'source-task',
      {
        instructions: 'Need a product decision',
        context: { requested_by: 'ops' },
      },
    );

    expect(result.input).toMatchObject({
      human_escalation_response: {
        instructions: 'Need a product decision',
      },
    });
  });

  it('treats a repeated human escalation response as idempotent once it is recorded', async () => {
    const loadTaskOrThrow = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'source-task',
        metadata: { escalation_task_id: 'escalation-task' },
      })
      .mockResolvedValueOnce({
        id: 'escalation-task',
        input: {
          source_task_id: 'source-task',
          human_escalation_response: {
            instructions: 'Need a product decision',
            context: { requested_by: 'ops' },
          },
        },
        metadata: {
          human_escalation_response_at: '2026-03-12T00:00:00.000Z',
        },
      });

    const client = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow,
      toTaskResponse: (task) => task,
    });

    const result = await service.respondToEscalation(
      {
        id: 'admin',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: null,
        keyPrefix: 'admin',
      },
      'source-task',
      {
        instructions: 'Need a product decision',
        context: { requested_by: 'ops' },
      },
    );

    expect(result).toMatchObject({
      id: 'escalation-task',
      input: {
        human_escalation_response: {
          instructions: 'Need a product decision',
          context: { requested_by: 'ops' },
        },
      },
    });
    expect(client.query).not.toHaveBeenCalled();
  });

  it('treats a repeated escalation resolution as idempotent once the task already reflects it', async () => {
    const client = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };
    const existingTask = {
      id: 'escalated-task',
      state: 'ready',
      input: {
        escalation_resolution: {
          instructions: 'Proceed with the product decision',
          context: { source: 'ops' },
        },
      },
      metadata: {},
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue(existingTask),
      toTaskResponse: (task) => task,
    });

    const result = await service.resolveEscalation(
      {
        id: 'admin',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: null,
        keyPrefix: 'admin',
      },
      'escalated-task',
      {
        instructions: 'Proceed with the product decision',
        context: { source: 'ops' },
      },
    );

    expect(result).toEqual(existingTask);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('reopens an escalated source task in pending when escalation resolution would exceed playbook capacity', async () => {
    const eventService = { emit: vi.fn() };
    const parallelismService = {
      shouldQueueForCapacity: vi.fn(async () => true),
      releaseQueuedReadyTasks: vi.fn(async () => 1),
    };
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET') && !sql.includes('state = $4::task_state')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'escalation-task',
                state: 'completed',
                workflow_id: 'wf-1',
                is_orchestrator_task: false,
                assigned_agent_id: null,
                assigned_worker_id: null,
                role: 'reviewer',
                output: { resolution: 'Ship it' },
                metadata: { escalation_source_task_id: 'source-task' },
              },
            ],
          };
        }
        if (sql.includes("WHERE tenant_id = $1 AND state = 'pending' AND $2 = ANY(depends_on)")) {
          return { rowCount: 0, rows: [] };
        }
        if (sql === 'SELECT playbook_id FROM workflows WHERE tenant_id = $1 AND id = $2') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('SELECT * FROM tasks WHERE tenant_id = $1 AND id = $2 FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'source-task',
                state: 'escalated',
                workflow_id: 'wf-1',
                work_item_id: 'wi-1',
                stage_name: 'build',
                assigned_agent_id: null,
                assigned_worker_id: null,
                input: {},
                metadata: {},
              },
            ],
          };
        }
        if (sql.includes('state = $4::task_state')) {
          expect(values).toEqual([
            'tenant-1',
            'source-task',
            expect.objectContaining({
              escalation_resolution: expect.objectContaining({
                resolved_by_role: 'reviewer',
                resolved_by_task_id: 'escalation-task',
              }),
            }),
            'pending',
          ]);
          return { rowCount: 1, rows: [] };
        }
        return { rowCount: 0, rows: [] };
      }),
      release: vi.fn(),
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: eventService as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'escalation-task',
        state: 'in_progress',
        workflow_id: 'wf-1',
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        role: 'reviewer',
        role_config: {},
        output: null,
        metadata: { escalation_source_task_id: 'source-task' },
      }),
      toTaskResponse: (task) => task,
      parallelismService: parallelismService as never,
    });

    await service.completeTask(
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'ak',
      },
      'escalation-task',
      {
        output: { resolution: 'Ship it' },
      },
    );

    expect(parallelismService.shouldQueueForCapacity).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        taskId: 'source-task',
        workflowId: 'wf-1',
        workItemId: 'wi-1',
        currentState: 'escalated',
      }),
      client,
    );
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.state_changed',
        entityId: 'source-task',
        actorId: 'smart_escalation',
        data: expect.objectContaining({
          from_state: 'escalated',
          to_state: 'pending',
          reason: 'escalation_resolved',
        }),
      }),
      client,
    );
  });

  it('treats a repeated skip as idempotent once the skipped output is already stored', async () => {
    const client = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };
    const existingTask = {
      id: 'task-skip',
      state: 'completed',
      output: {
        skipped: true,
        reason: 'No longer needed',
      },
      metadata: {
        review_action: 'skip',
        review_feedback: 'No longer needed',
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

    const result = await service.skipTask(
      {
        id: 'admin',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: null,
        keyPrefix: 'admin',
      },
      'task-skip',
      { reason: 'No longer needed' },
    );

    expect(result).toEqual(existingTask);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('treats a repeated output override as idempotent once the overridden output is already stored', async () => {
    const client = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };
    const overriddenOutput = { summary: 'approved manually' };
    const existingTask = {
      id: 'task-override',
      state: 'completed',
      output: overriddenOutput,
      metadata: {
        review_action: 'override_output',
        review_feedback: 'Operator supplied the final output',
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

    const result = await service.overrideTaskOutput(
      {
        id: 'admin',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: null,
        keyPrefix: 'admin',
      },
      'task-override',
      {
        output: overriddenOutput,
        reason: 'Operator supplied the final output',
      },
    );

    expect(result).toEqual(existingTask);
    expect(client.query).not.toHaveBeenCalled();
  });
});

describe('TaskLifecycleService replay-safe idempotent guards', () => {
  const agentIdentity = {
    id: 'agent-key',
    tenantId: 'tenant-1',
    scope: 'agent' as const,
    ownerType: 'agent',
    ownerId: 'agent-1',
    keyPrefix: 'ak',
  };

  function buildService(overrides: Partial<TaskLifecycleDependencies> = {}) {
    const client = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };
    return {
      client,
      service: new TaskLifecycleService({
        pool: { connect: vi.fn(async () => client) } as never,
        eventService: { emit: vi.fn() } as never,
        workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
        defaultTaskTimeoutMinutes: 30,
        loadTaskOrThrow: vi.fn(),
        toTaskResponse: (task: Record<string, unknown>) => task,
        ...overrides,
      }),
    };
  }

  it('returns the existing task when startTask replays for an already in-progress task with matching agent', async () => {
    const existingTask = {
      id: 'task-start-replay',
      state: 'in_progress',
      workflow_id: null,
      assigned_agent_id: 'agent-1',
      assigned_worker_id: null,
    };
    const { service, client } = buildService({
      loadTaskOrThrow: vi.fn().mockResolvedValue(existingTask),
    });

    const result = await service.startTask(agentIdentity, 'task-start-replay', {
      agent_id: 'agent-1',
    });

    expect(result).toEqual(existingTask);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('does not short-circuit startTask when the in-progress task belongs to a different agent', async () => {
    const existingTask = {
      id: 'task-start-different-agent',
      state: 'in_progress',
      workflow_id: null,
      assigned_agent_id: 'agent-other',
      assigned_worker_id: null,
    };
    const loadTaskOrThrow = vi
      .fn()
      .mockResolvedValueOnce(existingTask)
      .mockResolvedValueOnce(existingTask);
    const { service } = buildService({ loadTaskOrThrow });

    await expect(
      service.startTask(agentIdentity, 'task-start-different-agent', { agent_id: 'agent-1' }),
    ).rejects.toThrow();
  });

  it('returns the existing task when completeTask replays for an already completed task with matching output', async () => {
    const existingTask = {
      id: 'task-complete-replay',
      state: 'completed',
      workflow_id: null,
      assigned_agent_id: 'agent-1',
      assigned_worker_id: null,
      output: { summary: 'done' },
      role_config: {},
    };
    const { service, client } = buildService({
      loadTaskOrThrow: vi.fn().mockResolvedValue(existingTask),
    });

    const result = await service.completeTask(agentIdentity, 'task-complete-replay', {
      output: { summary: 'done' },
    });

    expect(result).toEqual(existingTask);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('returns the existing task when completeTask replays for an output_pending_review task with matching output', async () => {
    const existingTask = {
      id: 'task-review-replay',
      state: 'output_pending_review',
      workflow_id: null,
      assigned_agent_id: 'agent-1',
      assigned_worker_id: null,
      output: { result: 42 },
      role_config: {},
    };
    const { service, client } = buildService({
      loadTaskOrThrow: vi.fn().mockResolvedValue(existingTask),
    });

    const result = await service.completeTask(agentIdentity, 'task-review-replay', {
      output: { result: 42 },
    });

    expect(result).toEqual(existingTask);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('does not short-circuit completeTask when the stored output differs from the payload', async () => {
    const existingTask = {
      id: 'task-complete-diff-output',
      state: 'completed',
      workflow_id: null,
      assigned_agent_id: 'agent-1',
      assigned_worker_id: null,
      output: { summary: 'done' },
      role_config: {},
    };
    const loadTaskOrThrow = vi
      .fn()
      .mockResolvedValueOnce(existingTask)
      .mockResolvedValueOnce(existingTask);
    const { service } = buildService({ loadTaskOrThrow });

    await expect(
      service.completeTask(agentIdentity, 'task-complete-diff-output', {
        output: { summary: 'different' },
      }),
    ).rejects.toThrow();
  });

  it('returns the existing task when failTask replays for an already failed task with matching error', async () => {
    const existingTask = {
      id: 'task-fail-replay',
      state: 'failed',
      workflow_id: null,
      assigned_agent_id: 'agent-1',
      assigned_worker_id: null,
      error: { category: 'timeout', message: 'too slow' },
      metadata: {},
    };
    const { service, client } = buildService({
      loadTaskOrThrow: vi.fn().mockResolvedValue(existingTask),
    });

    const result = await service.failTask(agentIdentity, 'task-fail-replay', {
      error: { category: 'timeout', message: 'too slow' },
    });

    expect(result).toEqual(existingTask);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('returns the existing task when failTask replays and the task has already retried to pending with matching retry_last_error', async () => {
    const existingTask = {
      id: 'task-fail-retried',
      state: 'pending',
      workflow_id: null,
      assigned_agent_id: null,
      assigned_worker_id: null,
      error: null,
      metadata: {
        retry_last_error: { category: 'timeout', message: 'too slow' },
      },
    };
    const { service, client } = buildService({
      loadTaskOrThrow: vi.fn().mockResolvedValue(existingTask),
    });

    const result = await service.failTask(agentIdentity, 'task-fail-retried', {
      error: { category: 'timeout', message: 'too slow' },
    });

    expect(result).toEqual(existingTask);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('returns the existing task when failTask replays and the task has already retried to ready with matching retry_last_error', async () => {
    const existingTask = {
      id: 'task-fail-retried-ready',
      state: 'ready',
      workflow_id: null,
      assigned_agent_id: null,
      assigned_worker_id: null,
      error: null,
      metadata: {
        retry_last_error: { category: 'timeout', message: 'too slow' },
      },
    };
    const { service, client } = buildService({
      loadTaskOrThrow: vi.fn().mockResolvedValue(existingTask),
    });

    const result = await service.failTask(agentIdentity, 'task-fail-retried-ready', {
      error: { category: 'timeout', message: 'too slow' },
    });

    expect(result).toEqual(existingTask);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('does not short-circuit failTask when the stored error differs from the payload', async () => {
    const existingTask = {
      id: 'task-fail-diff-error',
      state: 'failed',
      workflow_id: null,
      assigned_agent_id: 'agent-1',
      assigned_worker_id: null,
      error: { category: 'timeout', message: 'too slow' },
      metadata: {},
    };
    const loadTaskOrThrow = vi
      .fn()
      .mockResolvedValueOnce(existingTask)
      .mockResolvedValueOnce(existingTask);
    const { service } = buildService({ loadTaskOrThrow });

    await expect(
      service.failTask(agentIdentity, 'task-fail-diff-error', {
        error: { category: 'validation_error', message: 'bad input' },
      }),
    ).rejects.toThrow();
  });
});
