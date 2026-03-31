import { describe, expect, it, vi } from 'vitest';
import { ValidationError } from '../../../src/errors/domain-errors.js';
import { TaskLifecycleService } from '../../../src/services/task-lifecycle/task-lifecycle-service.js';
type TaskLifecycleDependencies = ConstructorParameters<typeof TaskLifecycleService>[0];
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
});
