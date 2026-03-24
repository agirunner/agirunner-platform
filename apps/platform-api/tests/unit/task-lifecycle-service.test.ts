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

  it('records delivery output revision metadata when a delivery task completes', async () => {
    let metadataPatch: Record<string, unknown> | null = null;
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          metadataPatch = ((values ?? []).find(
            (value) => value && typeof value === 'object' && !Array.isArray(value)
              && ('verification' in (value as Record<string, unknown>) || 'output_revision' in (value as Record<string, unknown>)),
          ) as Record<string, unknown> | undefined) ?? null;
          return {
            rowCount: 1,
            rows: [
              {
                id: 'task-delivery',
                state: 'completed',
                workflow_id: 'workflow-1',
                work_item_id: 'work-item-1',
                assigned_agent_id: null,
                assigned_worker_id: null,
                rework_count: 0,
                output: { ok: true },
                metadata: {
                  task_kind: 'delivery',
                  output_revision: 1,
                  verification: { passed: true },
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
      pool: { connect: vi.fn(async () => client), query: client.query } as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-delivery',
        state: 'in_progress',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        assigned_agent_id: 'agent-1',
        assigned_worker_id: 'worker-1',
        role_config: {},
        rework_count: 0,
        metadata: { task_kind: 'delivery' },
      }),
      toTaskResponse: (task) => task,
      handoffService: {
        assertRequiredTaskHandoffBeforeCompletion: vi.fn(async () => undefined),
      } as never,
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
      'task-delivery',
      {
        output: { ok: true },
        verification: { passed: true },
      },
    );

    expect(metadataPatch).toEqual(
      expect.objectContaining({
        verification: { passed: true },
        output_revision: 1,
      }),
    );
    expect(result.metadata).toMatchObject({
      task_kind: 'delivery',
      output_revision: 1,
      verification: { passed: true },
    });
  });

  it('moves completion to output_pending_assessment when output schema validation fails', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'task-review',
                state: 'output_pending_assessment',
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

    expect(result.state).toBe('output_pending_assessment');
  });

  it('records continuity expectations even when completion stays completed', async () => {
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') {
          return { rows: [], rowCount: 0 };
        }
        if (sql.startsWith('UPDATE tasks SET')) {
          expect(values?.[2]).toBe('completed');
          return {
            rowCount: 1,
            rows: [{
              id: 'task-review-needed',
              state: 'completed',
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
              request_id: 'task-output_pending_assessment:task-review-needed:updated',
              reason: 'task.output_pending_assessment',
              event_type: 'task.output_pending_assessment',
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
        nextExpectedAction: 'assess',
        requiresHumanApproval: false,
        reworkDelta: 0,
        satisfiedAssessmentExpectation: false,
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

    expect(result.state).toBe('completed');
    expect(workItemContinuityService.recordTaskCompleted).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        id: 'task-review-needed',
        state: 'completed',
        work_item_id: 'work-item-1',
        role: 'developer',
      }),
      client,
    );
  });

  it('re-arms an open child review work item when verification failure returns work to output assessment', async () => {
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') {
          return { rows: [], rowCount: 0 };
        }
        if (sql.startsWith('UPDATE tasks SET')) {
          expect(values?.[2]).toBe('output_pending_assessment');
          return {
            rowCount: 1,
            rows: [{
              id: 'task-rework-resubmitted',
              state: 'output_pending_assessment',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              stage_name: 'implementation',
              role: 'developer',
              rework_count: 1,
              output: { summary: 'ready for re-review' },
              metadata: {},
            }],
          };
        }
        if (
          sql.includes('UPDATE workflow_work_items')
          && sql.includes("parent_work_item_id = $3")
          && sql.includes("COALESCE(assessment_task.metadata->>'task_kind', '') = 'assessment'")
        ) {
          return { rows: [], rowCount: 1 };
        }
        if (sql === 'SELECT playbook_id FROM workflows WHERE tenant_id = $1 AND id = $2') {
          return { rows: [{ playbook_id: 'playbook-1' }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO workflow_activations')) {
          return {
            rows: [{
              id: 'activation-review-resubmitted',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'task-output_pending_assessment:task-rework-resubmitted:updated',
              reason: 'task.output_pending_assessment',
              event_type: 'task.output_pending_assessment',
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
        nextExpectedAction: 'assess',
        requiresHumanApproval: false,
        reworkDelta: 0,
        satisfiedAssessmentExpectation: false,
      })),
    };
    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-rework-resubmitted',
        state: 'in_progress',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        stage_name: 'implementation',
        role: 'developer',
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        rework_count: 1,
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
      'task-rework-resubmitted',
      {
        output: { summary: 'ready for re-review' },
        verification: { passed: false },
      },
    );

    expect(result.state).toBe('output_pending_assessment');
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE workflow_work_items'),
      ['tenant-1', 'workflow-1', 'work-item-1'],
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("next_expected_action = 'assess'"),
      ['tenant-1', 'workflow-1', 'work-item-1'],
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
            rows: [{ resolution: 'approved' }],
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
                output: { resolution: 'approved' },
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
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        rework_count: 0,
        input: { subject_task_id: 'task-implementation' },
        metadata: { task_kind: 'assessment' },
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
        output: { resolution: 'approved' },
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
        throw new ValidationError('Task requires a structured handoff before completion', {
          reason_code: 'required_structured_handoff',
          recovery_hint: 'submit_required_handoff',
        });
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
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        reason_code: 'required_structured_handoff',
        recovery_hint: 'submit_required_handoff',
      },
    });

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
        assessment_action: 'approve',
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

  it('enqueues a workflow activation when approving a playbook-backed task', async () => {
    const eventService = { emit: vi.fn() };
    const activationDispatchService = { dispatchActivation: vi.fn(async () => 'orchestrator-task-1') };
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-approve',
              state: 'ready',
              workflow_id: 'workflow-1',
              role: 'reviewer',
              title: 'Approve deliverable',
              work_item_id: 'work-item-1',
              stage_name: 'approval',
              is_orchestrator_task: false,
              metadata: { assessment_action: 'approve' },
              updated_at: new Date('2026-03-17T10:00:00Z'),
            }],
          };
        }
        if (sql.startsWith('SELECT playbook_id FROM workflows')) {
          return { rows: [{ playbook_id: 'playbook-1' }], rowCount: 1 };
        }
        if (sql.startsWith('INSERT INTO workflow_activations')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'task-approved:task-approve:Tue Mar 17 2026 10:00:00 GMT+0000 (Coordinated Universal Time)',
              reason: 'task.approved',
              event_type: 'task.approved',
              payload: { task_id: 'task-approve' },
              state: 'queued',
              dispatch_attempt: 0,
              dispatch_token: null,
              queued_at: new Date('2026-03-17T10:00:00Z'),
              started_at: null,
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
          };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: eventService as never,
      activationDispatchService: activationDispatchService as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-approve',
        state: 'awaiting_approval',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        stage_name: 'approval',
        role: 'reviewer',
        title: 'Approve deliverable',
        is_orchestrator_task: false,
        metadata: {},
      }),
      toTaskResponse: (task) => task,
      workItemContinuityService: { clearAssessmentExpectation: vi.fn() } as never,
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

    expect(result.state).toBe('ready');
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO workflow_activations'),
      expect.arrayContaining([
        'tenant-1',
        'workflow-1',
        expect.stringContaining('task-approved:task-approve:'),
        'task.approved',
        'task.approved',
      ]),
    );
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workflow.activation_queued',
        entityType: 'workflow',
        entityId: 'workflow-1',
        data: expect.objectContaining({
          event_type: 'task.approved',
          reason: 'task.approved',
        }),
      }),
      expect.anything(),
    );
    expect(activationDispatchService.dispatchActivation).toHaveBeenCalledWith(
      'tenant-1',
      'activation-1',
      client,
    );
  });

  it('records assessment metadata when requesting task changes', async () => {
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
                input: { assessment_feedback: 'Fix the failing assertions' },
                metadata: { assessment_action: 'request_changes', preferred_agent_id: 'agent-2' },
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
        state: 'output_pending_assessment',
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
    expect(result.input).toMatchObject({ assessment_feedback: 'Fix the failing assertions' });
    expect(result.metadata).toMatchObject({
      assessment_action: 'request_changes',
      preferred_agent_id: 'agent-2',
    });
    const updateCall = client.query.mock.calls.find(([sql]) => typeof sql === 'string' && sql.startsWith('UPDATE tasks SET')) as
      | [string, unknown[]]
      | undefined;
    expect(updateCall?.[1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ assessment_feedback: 'Fix the failing assertions' }),
        expect.objectContaining({ assessment_action: 'request_changes', preferred_agent_id: 'agent-2' }),
      ]),
    );
  });

  it('refreshes the reopened task contract from explicit rework scope when requesting changes', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'task-rework-scope',
                state: 'ready',
                workflow_id: null,
                input: {
                  description: 'Deliver revision 2 release-ready fields and docs.',
                  rework_completion_scope: 'Deliver revision 2 release-ready fields and docs.',
                  assessment_feedback: 'Add the release-ready payload and README coverage.',
                },
                metadata: {
                  description: 'Deliver revision 2 release-ready fields and docs.',
                  assessment_action: 'request_changes',
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
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-rework-scope',
        state: 'output_pending_assessment',
        workflow_id: null,
        input: {
          description: 'Implement revision 1 only.',
          rework_completion_scope: 'Deliver revision 2 release-ready fields and docs.',
        },
        rework_count: 0,
        metadata: {
          description: 'Implement revision 1 only.',
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
      'task-rework-scope',
      {
        feedback: 'Add the release-ready payload and README coverage.',
      },
    );

    expect(result.input).toMatchObject({
      description: 'Deliver revision 2 release-ready fields and docs.',
      rework_completion_scope: 'Deliver revision 2 release-ready fields and docs.',
      assessment_feedback: 'Add the release-ready payload and README coverage.',
    });
    expect(result.metadata).toMatchObject({
      description: 'Deliver revision 2 release-ready fields and docs.',
      assessment_action: 'request_changes',
    });

    const updateCall = client.query.mock.calls.find(([sql]) => typeof sql === 'string' && sql.startsWith('UPDATE tasks SET')) as
      | [string, unknown[]]
      | undefined;
    expect(updateCall?.[1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          description: 'Deliver revision 2 release-ready fields and docs.',
          rework_completion_scope: 'Deliver revision 2 release-ready fields and docs.',
          assessment_feedback: 'Add the release-ready payload and README coverage.',
        }),
        expect.objectContaining({
          description: 'Deliver revision 2 release-ready fields and docs.',
          assessment_action: 'request_changes',
        }),
      ]),
    );
  });

  it('refreshes the reopened task description from the latest assessment feedback when no explicit rework scope exists', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'task-feedback-scope',
                state: 'ready',
                workflow_id: null,
                input: {
                  description:
                    'Implement the initial API baseline.\n\nRework required:\nAdd rollback coverage and refresh compatibility notes.',
                  assessment_feedback: 'Add rollback coverage and refresh compatibility notes.',
                },
                metadata: {
                  description:
                    'Implement the initial API baseline.\n\nRework required:\nAdd rollback coverage and refresh compatibility notes.',
                  assessment_action: 'request_changes',
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
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-feedback-scope',
        state: 'output_pending_assessment',
        workflow_id: null,
        input: {
          description: 'Implement the initial API baseline.',
          assessment_feedback: 'Old feedback that should be replaced.',
        },
        rework_count: 0,
        metadata: {
          description: 'Implement the initial API baseline.',
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
      'task-feedback-scope',
      {
        feedback: 'Add rollback coverage and refresh compatibility notes.',
      },
    );

    expect(result.input).toMatchObject({
      description:
        'Implement the initial API baseline.\n\nRework required:\nAdd rollback coverage and refresh compatibility notes.',
      assessment_feedback: 'Add rollback coverage and refresh compatibility notes.',
    });
    expect(result.metadata).toMatchObject({
      description:
        'Implement the initial API baseline.\n\nRework required:\nAdd rollback coverage and refresh compatibility notes.',
      assessment_action: 'request_changes',
    });

    const updateCall = client.query.mock.calls.find(([sql]) => typeof sql === 'string' && sql.startsWith('UPDATE tasks SET')) as
      | [string, unknown[]]
      | undefined;
    expect(updateCall?.[1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          description:
            'Implement the initial API baseline.\n\nRework required:\nAdd rollback coverage and refresh compatibility notes.',
          assessment_feedback: 'Add rollback coverage and refresh compatibility notes.',
        }),
        expect.objectContaining({
          description:
            'Implement the initial API baseline.\n\nRework required:\nAdd rollback coverage and refresh compatibility notes.',
          assessment_action: 'request_changes',
        }),
      ]),
    );
  });

  it('enqueues a workflow activation when an assessment requests changes on a playbook-backed task', async () => {
    const eventService = { emit: vi.fn() };
    const activationDispatchService = { dispatchActivation: vi.fn(async () => 'orchestrator-task-2') };
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-review-loop',
              state: 'ready',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              stage_name: 'review',
              role: 'reviewer',
              title: 'Review deliverable',
              is_orchestrator_task: false,
              input: { assessment_feedback: 'Fix the failing assertions' },
              metadata: { assessment_action: 'request_changes', preferred_agent_id: 'agent-2' },
              rework_count: 1,
              updated_at: new Date('2026-03-17T10:15:00Z'),
            }],
          };
        }
        if (sql.startsWith('SELECT playbook_id FROM workflows')) {
          return { rows: [{ playbook_id: 'playbook-1' }], rowCount: 1 };
        }
        if (sql.startsWith('INSERT INTO workflow_activations')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-2',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'task-assessment-requested:task-review-loop:Tue Mar 17 2026 10:15:00 GMT+0000 (Coordinated Universal Time)',
              reason: 'task.assessment_requested_changes',
              event_type: 'task.assessment_requested_changes',
              payload: { task_id: 'task-review-loop' },
              state: 'queued',
              dispatch_attempt: 0,
              dispatch_token: null,
              queued_at: new Date('2026-03-17T10:15:00Z'),
              started_at: null,
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
          };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: eventService as never,
      activationDispatchService: activationDispatchService as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-review-loop',
        state: 'output_pending_assessment',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        stage_name: 'review',
        role: 'reviewer',
        title: 'Review deliverable',
        is_orchestrator_task: false,
        input: { summary: 'old output' },
        rework_count: 0,
        metadata: {},
      }),
      toTaskResponse: (task) => task,
      workItemContinuityService: { recordAssessmentRequestedChanges: vi.fn() } as never,
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
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO workflow_activations'),
      expect.arrayContaining([
        'tenant-1',
        'workflow-1',
        expect.stringContaining('task-assessment-requested:task-review-loop:'),
        'task.assessment_requested_changes',
        'task.assessment_requested_changes',
      ]),
    );
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workflow.activation_queued',
        entityType: 'workflow',
        entityId: 'workflow-1',
        data: expect.objectContaining({
          event_type: 'task.assessment_requested_changes',
          reason: 'task.assessment_requested_changes',
        }),
      }),
      expect.anything(),
    );
    expect(activationDispatchService.dispatchActivation).toHaveBeenCalledWith(
      'tenant-1',
      'activation-2',
      client,
    );
  });

  it('clears stale child review work item routing when request-changes reopens implementation rework', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-impl',
              state: 'ready',
              workflow_id: 'workflow-1',
              work_item_id: 'implementation-item',
              stage_name: 'implementation',
              role: 'developer',
              title: 'Implement change',
              is_orchestrator_task: false,
              input: { assessment_feedback: 'Tighten the invalid-input assertions' },
              metadata: { assessment_action: 'request_changes' },
              rework_count: 1,
              updated_at: new Date('2026-03-21T02:10:00Z'),
            }],
          };
        }
        if (
          sql.includes('FROM workflow_work_items wi')
          && sql.includes('JOIN workflows w')
          && sql.includes('JOIN playbooks p')
        ) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'implementation-item']);
          return {
            rowCount: 1,
            rows: [{
              workflow_id: 'workflow-1',
              work_item_id: 'implementation-item',
              stage_name: 'implementation',
              column_id: 'done',
              completed_at: new Date('2026-03-21T02:05:00Z'),
              definition: {
                roles: ['developer', 'reviewer'],
                lifecycle: 'planned',
                board: {
                  columns: [
                    { id: 'planned', label: 'Planned' },
                    { id: 'done', label: 'Done', is_terminal: true },
                  ],
                },
                stages: [
                  { name: 'implementation', goal: 'Implement the change' },
                  { name: 'review', goal: 'Review the change' },
                ],
              },
            }],
          };
        }
        if (
          sql.includes('UPDATE workflow_work_items')
          && sql.includes('SET column_id = $4')
          && sql.includes('completed_at = NULL')
          && sql.includes('id = $3')
          && sql.includes('completed_at IS NOT NULL')
        ) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'implementation-item', 'planned']);
          return {
            rowCount: 1,
            rows: [{
              id: 'implementation-item',
            }],
          };
        }
        if (sql.includes('UPDATE workflow_work_items') && sql.includes("parent_work_item_id = $3")) {
          return { rows: [], rowCount: 1 };
        }
        if (sql.startsWith('SELECT playbook_id FROM workflows')) {
          return { rows: [{ playbook_id: 'playbook-1' }], rowCount: 1 };
        }
        if (sql.startsWith('INSERT INTO workflow_activations')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-2',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'task-assessment-requested:task-impl:Fri Mar 21 2026 02:10:00 GMT+0000 (Coordinated Universal Time)',
              reason: 'task.assessment_requested_changes',
              event_type: 'task.assessment_requested_changes',
              payload: { task_id: 'task-impl' },
              state: 'queued',
              dispatch_attempt: 0,
              dispatch_token: null,
              queued_at: new Date('2026-03-21T02:10:00Z'),
              started_at: null,
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
          };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    const recordAssessmentRequestedChanges = vi.fn(async () => undefined);

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-impl',
        state: 'output_pending_assessment',
        workflow_id: 'workflow-1',
        work_item_id: 'implementation-item',
        stage_name: 'implementation',
        role: 'developer',
        title: 'Implement change',
        is_orchestrator_task: false,
        input: { summary: 'old output' },
        rework_count: 0,
        metadata: {},
      }),
      toTaskResponse: (task) => task,
      workItemContinuityService: { recordAssessmentRequestedChanges } as never,
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
      'task-impl',
      {
        feedback: 'Tighten the invalid-input assertions',
      },
    );

    expect(recordAssessmentRequestedChanges).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        id: 'task-impl',
        work_item_id: 'implementation-item',
      }),
      client,
    );

    const reviewResetCall = client.query.mock.calls.find(
      ([sql]) =>
        typeof sql === 'string'
        && sql.includes('UPDATE workflow_work_items wi')
        && sql.includes("parent_work_item_id = $3")
        && sql.includes("COALESCE(assessment_task.metadata->>'task_kind', '') = 'assessment'")
        && sql.includes("metadata = COALESCE(metadata, '{}'::jsonb) - 'orchestrator_finish_state'"),
    ) as [string, unknown[]] | undefined;

    expect(reviewResetCall?.[1]).toEqual([
      'tenant-1',
      'workflow-1',
      'implementation-item',
    ]);

    const reopenCall = client.query.mock.calls.find(
      ([sql]) =>
        typeof sql === 'string'
        && sql.includes('UPDATE workflow_work_items')
        && sql.includes('SET column_id = $4')
        && sql.includes('completed_at = NULL')
        && sql.includes('id = $3')
        && sql.includes('completed_at IS NOT NULL'),
    ) as [string, unknown[]] | undefined;

    expect(reopenCall?.[1]).toEqual([
      'tenant-1',
      'workflow-1',
      'implementation-item',
      'planned',
    ]);
  });

  it('clears completed_at when request-changes reopens a previously completed task', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-review-reopen',
              state: 'ready',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              stage_name: 'implementation',
              role: 'developer',
              title: 'Implement change',
              is_orchestrator_task: false,
              input: { assessment_feedback: 'Address the reviewer findings' },
              metadata: { assessment_action: 'request_changes' },
              rework_count: 1,
              completed_at: null,
            }],
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
        id: 'task-review-reopen',
        state: 'completed',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        stage_name: 'implementation',
        role: 'developer',
        title: 'Implement change',
        is_orchestrator_task: false,
        input: { summary: 'already shipped once' },
        rework_count: 0,
        completed_at: '2026-03-20T20:00:00.000Z',
        metadata: {},
      }),
      toTaskResponse: (task) => task,
      workItemContinuityService: { recordAssessmentRequestedChanges: vi.fn() } as never,
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
      'task-review-reopen',
      {
        feedback: 'Address the reviewer findings',
      },
    );

    expect(result.state).toBe('ready');
    expect(result.completed_at).toBeNull();

    const updateCall = client.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.startsWith('UPDATE tasks SET'),
    ) as [string, unknown[]] | undefined;

    expect(updateCall?.[0]).toContain('completed_at = NULL');
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
      input: { assessment_feedback: 'Fix the failing assertions' },
      metadata: {
        assessment_action: 'request_changes',
        assessment_feedback: 'Fix the failing assertions',
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

  it('rejects a completed task when a later assessment blocks the delivered revision', async () => {
    const updatedTask = {
      id: 'task-delivery-rejected',
      state: 'failed',
      workflow_id: null,
      assigned_worker_id: null,
      assigned_agent_id: null,
      is_orchestrator_task: false,
      metadata: {
        assessment_action: 'reject',
        assessment_feedback: 'The delivered revision is rejected.',
      },
      error: {
        category: 'assessment_rejected',
        message: 'The delivered revision is rejected.',
        recoverable: true,
      },
    };
    const client = {
      query: vi.fn(async () => ({ rows: [updatedTask], rowCount: 1 })),
      release: vi.fn(),
    };
    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn(async () => undefined) } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn(async () => ({
        id: 'task-delivery-rejected',
        state: 'completed',
        workflow_id: null,
        assigned_worker_id: null,
        assigned_agent_id: null,
        is_orchestrator_task: false,
        metadata: {},
      })),
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
      'task-delivery-rejected',
      {
        feedback: 'The delivered revision is rejected.',
      },
    );

    expect(result).toEqual(updatedTask);
    expect(client.query).toHaveBeenCalled();
  });

  it('fails and escalates when request-changes exceeds the configured max rework count', async () => {
    const eventService = { emit: vi.fn() };
    const logService = { insert: vi.fn(async () => undefined) };
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
        state: 'output_pending_assessment',
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
      logService: logService as never,
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
    expect(logService.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'task.max_rework_exceeded',
        taskId: 'task-max-rework',
        payload: expect.objectContaining({
          event_type: 'task.max_rework_exceeded',
          max_rework_count: 2,
        }),
      }),
    );
    expect(logService.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'task.escalation.policy',
        taskId: 'task-max-rework',
        payload: expect.objectContaining({
          event_type: 'task.escalation',
        }),
      }),
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
                metadata: { preferred_worker_id: 'worker-3', assessment_action: 'reassign' },
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
      assessment_action: 'reassign',
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
        expect.objectContaining({ preferred_worker_id: 'worker-3', assessment_action: 'reassign' }),
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
        assessment_action: 'reassign',
        assessment_feedback: 'Move to a healthier worker',
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
        assessment_action: 'reassign',
        assessment_feedback: 'Move to a healthier worker',
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
    const logService = { insert: vi.fn(async () => undefined) };
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
      logService: logService as never,
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
    expect(logService.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'task.retry.scheduled',
        taskId: 'task-retry-policy',
        payload: expect.objectContaining({
          event_type: 'task.retry_scheduled',
          retry_count: 1,
          backoff_seconds: 5,
        }),
      }),
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

  it('releases queued specialist tasks when a task enters output_pending_assessment', async () => {
    const eventService = { emit: vi.fn() };
    const parallelismService = {
      releaseQueuedReadyTasks: vi.fn(async () => 1),
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
                id: 'task-review-slot',
                state: 'output_pending_assessment',
                workflow_id: 'wf-1',
                is_orchestrator_task: false,
                assigned_agent_id: 'agent-1',
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
        id: 'task-review-slot',
        state: 'in_progress',
        workflow_id: 'wf-1',
        is_orchestrator_task: false,
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        metadata: {},
      }),
      toTaskResponse: (task) => task,
      parallelismService: parallelismService as never,
      handoffService: {
        assertRequiredTaskHandoffBeforeCompletion: vi.fn(async () => undefined),
      } as never,
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
      'task-review-slot',
      {
        output: { summary: 'ready for review' },
        verification: { passed: false },
      },
    );

    expect(result.state).toBe('output_pending_assessment');
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
        workspace_id: null,
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
        workspace_id: null,
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
    const logService = { insert: vi.fn(async () => undefined) };
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
                  assessment_action: 'escalate',
                  assessment_feedback: 'Need operator guidance',
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
      logService: logService as never,
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
      assessment_action: 'escalate',
      assessment_feedback: 'Need operator guidance',
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
    expect(logService.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'task.escalation.manual',
        taskId: 'task-manual-escalate',
        payload: expect.objectContaining({
          event_type: 'task.escalated',
          escalation_target: 'human',
          escalation_reason: 'Need operator guidance',
        }),
      }),
    );
  });

  it('queues role-based escalation tasks in pending and preserves work-item scope when caps are full', async () => {
    const eventService = { emit: vi.fn() };
    const logService = { insert: vi.fn(async () => undefined) };
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
                workspace_id: null,
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
        workspace_id: null,
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
      logService: logService as never,
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
    expect(logService.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'task.escalation.agent',
        taskId: 'task-role-escalate',
        workItemId: 'wi-role',
        stageName: 'build',
        payload: expect.objectContaining({
          event_type: 'task.agent_escalated',
          escalation_target: 'reviewer',
        }),
      }),
    );
    expect(logService.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'task.escalation.task_created',
        taskId: 'task-role-escalate',
        workItemId: 'wi-role',
        stageName: 'build',
        payload: expect.objectContaining({
          event_type: 'task.escalation_task_created',
          escalation_task_id: 'role-escalation-task',
          target_role: 'reviewer',
          source_task_id: 'task-role-escalate',
        }),
      }),
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
        assessment_action: 'escalate',
        assessment_feedback: 'Need operator guidance',
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
    const logService = { insert: vi.fn(async () => undefined) };
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
      logService: logService as never,
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
    expect(logService.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'task.escalation.response_recorded',
        taskId: 'source-task',
        payload: expect.objectContaining({
          event_type: 'task.escalation_response_recorded',
          escalation_task_id: 'escalation-task',
        }),
      }),
    );
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
        assessment_action: 'skip',
        assessment_feedback: 'No longer needed',
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
        assessment_action: 'override_output',
        assessment_feedback: 'Operator supplied the final output',
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

  it('returns the existing task when completeTask replays for an output_pending_assessment task with matching output', async () => {
    const existingTask = {
      id: 'task-review-replay',
      state: 'output_pending_assessment',
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

describe('TaskLifecycleService completion: verification and spend land in task rows', () => {
  it('propagates metrics, git_info, and verification into separate UPDATE columns', async () => {
    const capturedUpdates: { sql: string; values: unknown[] }[] = [];
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.startsWith('UPDATE tasks SET')) {
          capturedUpdates.push({ sql, values: (values ?? []) as unknown[] });
          return {
            rowCount: 1,
            rows: [{
              id: 'task-spend',
              state: 'completed',
              workflow_id: null,
              assigned_agent_id: null,
              assigned_worker_id: null,
              output: { result: 'ok' },
              metrics: { total_cost_usd: 2.50, total_tokens: 4096 },
              git_info: { git_commit: 'fa1afe1', git_push_ok: true },
              metadata: { verification: { passed: true, strategy: 'tests' } },
            }],
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
        id: 'task-spend',
        state: 'in_progress',
        workflow_id: null,
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        role_config: {},
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
      'task-spend',
      {
        output: { result: 'ok' },
        metrics: { total_cost_usd: 2.50, total_tokens: 4096 },
        git_info: { git_commit: 'fa1afe1', git_push_ok: true },
        verification: { passed: true, strategy: 'tests' },
      },
    );

    expect(result.state).toBe('completed');

    // Verify SQL contains separate metrics and git_info column assignments
    expect(capturedUpdates).toHaveLength(1);
    const { sql, values } = capturedUpdates[0]!;
    expect(sql).toContain('metrics =');
    expect(sql).toContain('git_info =');
    // verification is merged into metadata via jsonb concatenation
    expect(sql).toContain('metadata =');

    // Verify bound values include the spend metrics and verification data
    const metricsValue = values.find(
      (v) => typeof v === 'object' && v !== null && 'total_cost_usd' in (v as Record<string, unknown>),
    );
    expect(metricsValue).toMatchObject({ total_cost_usd: 2.50, total_tokens: 4096 });

    const gitInfoValue = values.find(
      (v) => typeof v === 'object' && v !== null && 'git_commit' in (v as Record<string, unknown>),
    );
    expect(gitInfoValue).toMatchObject({ git_commit: 'fa1afe1', git_push_ok: true });

    // Verification is stored in metadata patch
    const verificationPatch = values.find(
      (v) => typeof v === 'object' && v !== null && 'verification' in (v as Record<string, unknown>),
    );
    expect(verificationPatch).toMatchObject({ verification: { passed: true, strategy: 'tests' } });
  });
});

describe('TaskLifecycleService secret sanitization on completion/failure write path', () => {
  const REDACTED = 'redacted://secret';

  const agentIdentity = {
    id: 'agent-key',
    tenantId: 'tenant-1',
    scope: 'agent' as const,
    ownerType: 'agent',
    ownerId: 'agent-1',
    keyPrefix: 'ak',
  };

  function buildCapturingService(
    initialTaskOverrides: Record<string, unknown> = {},
    returnedRowOverrides: Record<string, unknown> = {},
  ) {
    const capturedUpdates: { sql: string; values: unknown[] }[] = [];
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') {
          return { rows: [], rowCount: 0 };
        }
        if (sql.startsWith('UPDATE tasks SET')) {
          capturedUpdates.push({ sql, values: (values ?? []) as unknown[] });
          return {
            rowCount: 1,
            rows: [{
              id: 'task-sanitize',
              state: 'completed',
              workflow_id: null,
              assigned_agent_id: null,
              assigned_worker_id: null,
              output: {},
              metrics: {},
              git_info: {},
              metadata: {},
              ...returnedRowOverrides,
            }],
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
        id: 'task-sanitize',
        state: 'in_progress',
        workflow_id: null,
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        role_config: {},
        metadata: {},
        retry_count: 0,
        ...initialTaskOverrides,
      }),
      toTaskResponse: (task) => task,
    });

    return { service, capturedUpdates };
  }

  it('completeTask redacts secret-like values from output, metrics, git_info, and verification', async () => {
    const { service, capturedUpdates } = buildCapturingService();

    await service.completeTask(agentIdentity, 'task-sanitize', {
      output: { result: 'ok', api_key: 'sk-live-abc123' },
      metrics: { duration: 10, authorization: 'Bearer my-secret-token' },
      git_info: { commit: 'abc123', token: 'ghp_supersecret' },
      verification: { passed: true, secret: 'hunter2' },
    });

    expect(capturedUpdates).toHaveLength(1);
    const { values } = capturedUpdates[0]!;

    // output — api_key value must be redacted
    const outputParam = values.find(
      (v) => typeof v === 'object' && v !== null && 'result' in (v as Record<string, unknown>),
    ) as Record<string, unknown>;
    expect(outputParam).toBeDefined();
    expect(outputParam.result).toBe('ok');
    expect(outputParam.api_key).toBe(REDACTED);

    // metrics — authorization value must be redacted
    const metricsParam = values.find(
      (v) => typeof v === 'object' && v !== null && 'duration' in (v as Record<string, unknown>),
    ) as Record<string, unknown>;
    expect(metricsParam).toBeDefined();
    expect(metricsParam.duration).toBe(10);
    expect(metricsParam.authorization).toBe(REDACTED);

    // git_info — token value must be redacted
    const gitInfoParam = values.find(
      (v) => typeof v === 'object' && v !== null && 'commit' in (v as Record<string, unknown>),
    ) as Record<string, unknown>;
    expect(gitInfoParam).toBeDefined();
    expect(gitInfoParam.commit).toBe('abc123');
    expect(gitInfoParam.token).toBe(REDACTED);

    // verification — stored in metadata patch, secret must be redacted
    const metadataPatch = values.find(
      (v) => typeof v === 'object' && v !== null && 'verification' in (v as Record<string, unknown>),
    ) as Record<string, unknown>;
    expect(metadataPatch).toBeDefined();
    const verification = metadataPatch.verification as Record<string, unknown>;
    expect(verification.passed).toBe(true);
    expect(verification.secret).toBe(REDACTED);
  });

  it('failTask redacts secret-like values from error, metrics, and git_info', async () => {
    const { service, capturedUpdates } = buildCapturingService({}, { state: 'failed' });

    await service.failTask(agentIdentity, 'task-sanitize', {
      error: { category: 'unknown', message: 'crashed', password: 'oops-plaintext' },
      metrics: { duration: 5, credential: 'secret-cred-value' },
      git_info: { branch: 'main', private_key: 'ssh-rsa AAAA' },
    });

    expect(capturedUpdates).toHaveLength(1);
    const { values } = capturedUpdates[0]!;

    // error — password value must be redacted
    const errorParam = values.find(
      (v) => typeof v === 'object' && v !== null && 'category' in (v as Record<string, unknown>) && 'password' in (v as Record<string, unknown>),
    ) as Record<string, unknown>;
    expect(errorParam).toBeDefined();
    expect(errorParam.category).toBe('unknown');
    expect(errorParam.message).toBe('crashed');
    expect(errorParam.password).toBe(REDACTED);

    // metrics — credential value must be redacted
    const metricsParam = values.find(
      (v) => typeof v === 'object' && v !== null && 'duration' in (v as Record<string, unknown>),
    ) as Record<string, unknown>;
    expect(metricsParam).toBeDefined();
    expect(metricsParam.duration).toBe(5);
    expect(metricsParam.credential).toBe(REDACTED);

    // git_info — private_key value must be redacted
    const gitInfoParam = values.find(
      (v) => typeof v === 'object' && v !== null && 'branch' in (v as Record<string, unknown>),
    ) as Record<string, unknown>;
    expect(gitInfoParam).toBeDefined();
    expect(gitInfoParam.branch).toBe('main');
    expect(gitInfoParam.private_key).toBe(REDACTED);
  });

  it('failTask redacts retry_last_error in metadata patch on auto-retry', async () => {
    const { service, capturedUpdates } = buildCapturingService(
      {
        metadata: {
          lifecycle_policy: {
            retry_policy: {
              max_attempts: 3,
              retryable_categories: ['timeout'],
              backoff_strategy: 'fixed',
              initial_backoff_seconds: 1,
            },
          },
        },
      },
      { state: 'pending' },
    );

    await service.failTask(agentIdentity, 'task-sanitize', {
      error: { category: 'timeout', message: 'timed out', recoverable: true, api_key: 'sk-leaked' },
    });

    expect(capturedUpdates).toHaveLength(1);
    const { values } = capturedUpdates[0]!;

    // metadata patch contains retry_last_error — api_key must be redacted
    const metadataPatch = values.find(
      (v) => typeof v === 'object' && v !== null && 'retry_last_error' in (v as Record<string, unknown>),
    ) as Record<string, unknown>;
    expect(metadataPatch).toBeDefined();
    const retryError = metadataPatch.retry_last_error as Record<string, unknown>;
    expect(retryError.category).toBe('timeout');
    expect(retryError.message).toBe('timed out');
    expect(retryError.api_key).toBe(REDACTED);
  });

  it('completeTask replay detection still works after sanitization', async () => {
    const storedOutput = { result: 'ok', api_key: REDACTED };
    const client = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };
    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-replay-sanitized',
        state: 'completed',
        workflow_id: null,
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        output: storedOutput,
        role_config: {},
      }),
      toTaskResponse: (task) => task,
    });

    // Replay with the same secret material — the sanitized form should match
    const result = await service.completeTask(agentIdentity, 'task-replay-sanitized', {
      output: { result: 'ok', api_key: 'sk-live-abc123' },
    });

    expect(result.state).toBe('completed');
    // Should return the existing task without any UPDATE query
    expect(client.query).not.toHaveBeenCalled();
  });

  it('failTask replay detection still works after sanitization', async () => {
    const storedError = { category: 'timeout', message: 'timed out', api_key: REDACTED };
    const client = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };
    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-fail-replay-sanitized',
        state: 'failed',
        workflow_id: null,
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        error: storedError,
        metadata: {},
      }),
      toTaskResponse: (task) => task,
    });

    // Replay with the same secret material
    const result = await service.failTask(agentIdentity, 'task-fail-replay-sanitized', {
      error: { category: 'timeout', message: 'timed out', api_key: 'sk-leaked' },
    });

    expect(result.state).toBe('failed');
    expect(client.query).not.toHaveBeenCalled();
  });
});
