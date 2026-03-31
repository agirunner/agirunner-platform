import { describe, expect, it, vi } from 'vitest';
import { ValidationError } from '../../../src/errors/domain-errors.js';
import { TaskLifecycleService } from '../../../src/services/task-lifecycle-service.js';
type TaskLifecycleDependencies = ConstructorParameters<typeof TaskLifecycleService>[0];
describe('TaskLifecycleService worker identity + payload semantics', () => {
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


  it('allows enhanced-mode specialist completion to proceed without per-turn operator updates', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
        if (sql.includes('JOIN workflows w')) {
          expect(params).toEqual(['tenant-1', 'task-live-1']);
          return {
            rowCount: 1,
            rows: [{
              live_visibility_mode_override: 'enhanced',
              activation_id: 'activation-1',
              is_orchestrator_task: false,
            }],
          };
        }
        if (sql.includes('FROM agentic_settings')) {
          return { rowCount: 1, rows: [{ live_visibility_mode_default: 'enhanced' }] };
        }
        if (sql.includes('FROM workflow_operator_briefs')) {
          return { rowCount: 1, rows: [{ id: 'brief-live-1' }] };
        }
        if (sql.startsWith('UPDATE tasks SET')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-live-1',
              state: 'completed',
              workflow_id: 'workflow-1',
              role: 'developer',
              assigned_agent_id: null,
              assigned_worker_id: null,
              output: { ok: true },
              metadata: { verification: { passed: true } },
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
        id: 'task-live-1',
        state: 'in_progress',
        workflow_id: 'workflow-1',
        role: 'developer',
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        role_config: {},
      }),
      toTaskResponse: (task) => task,
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
      'task-live-1',
      {
        output: { ok: true },
        verification: { passed: true },
      },
    );

    expect(result.state).toBe('completed');
  });
});
