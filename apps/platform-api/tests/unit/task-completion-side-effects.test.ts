import { describe, expect, it, vi } from 'vitest';

import { applyTaskCompletionSideEffects } from '../../src/services/task-completion-side-effects.js';

describe('applyTaskCompletionSideEffects', () => {
  it('auto-completes the reviewed task when a review expectation is satisfied', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("FROM tasks\n     WHERE tenant_id = $1 AND state = 'pending'")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('SELECT playbook_id FROM workflows')) {
          return { rows: [{ playbook_id: 'playbook-1' }], rowCount: 1 };
        }
        if (sql.includes('FROM tasks') && sql.includes("AND state = 'output_pending_review'")) {
          return {
            rows: [{
              id: 'task-dev',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              role: 'developer',
              state: 'output_pending_review',
              output: { summary: 'done' },
              metadata: {},
            }],
            rowCount: 1,
          };
        }
        if (sql.startsWith('UPDATE tasks')) {
          return {
            rows: [{
              id: 'task-dev',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              workspace_id: 'workspace-1',
              role: 'developer',
              state: 'completed',
              output: { summary: 'done' },
              metadata: {
                review_action: 'approve_output',
                review_resolved_by_task_id: 'task-review',
              },
            }],
            rowCount: 1,
          };
        }
        if (sql.includes('INSERT INTO workflow_activations')) {
          return {
            rows: [{
              id: 'activation-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'task-completed:task-review:updated',
              reason: 'task.completed',
              event_type: 'task.completed',
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
        return { rows: [], rowCount: 1 };
      }),
    };
    const eventService = {
      emit: vi.fn(async () => undefined),
    };
    const workItemContinuityService = {
      recordTaskCompleted: vi.fn(async () => ({
        matchedRuleType: 'handoff',
        nextExpectedActor: 'qa',
        nextExpectedAction: 'handoff',
        requiresHumanApproval: false,
        reworkDelta: 0,
        satisfiedReviewExpectation: true,
      })),
    };

    await applyTaskCompletionSideEffects(
      eventService as never,
      undefined,
      workItemContinuityService as never,
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'agent-key',
      },
      {
        id: 'task-review',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        role: 'reviewer',
        stage_name: 'implementation',
        is_orchestrator_task: false,
        output: { verdict: 'approved' },
      },
      client as never,
    );

    expect(workItemContinuityService.recordTaskCompleted).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        id: 'task-review',
        work_item_id: 'work-item-1',
        role: 'reviewer',
      }),
      client,
    );
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.state_changed',
        entityId: 'task-dev',
        actorId: 'review_resolver',
        data: expect.objectContaining({
          from_state: 'output_pending_review',
          to_state: 'completed',
          reason: 'output_review_approved',
          review_task_id: 'task-review',
        }),
      }),
      client,
    );
  });

  it('records review rejection continuity for a full reviewer handoff that requests changes', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("FROM tasks\n     WHERE tenant_id = $1 AND state = 'pending'")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('SELECT playbook_id FROM workflows')) {
          return { rows: [{ playbook_id: 'playbook-1' }], rowCount: 1 };
        }
        if (sql.includes('FROM task_handoffs')) {
          return {
            rows: [{
              completion: 'full',
              resolution: 'request_changes',
            }],
            rowCount: 1,
          };
        }
        if (sql.includes('INSERT INTO workflow_activations')) {
          return {
            rows: [{
              id: 'activation-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'task-completed:task-review:updated',
              reason: 'task.completed',
              event_type: 'task.completed',
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
    };
    const eventService = {
      emit: vi.fn(async () => undefined),
    };
    const workItemContinuityService = {
      recordTaskCompleted: vi.fn(async () => ({
        matchedRuleType: 'review',
        nextExpectedActor: 'qa',
        nextExpectedAction: 'handoff',
        requiresHumanApproval: false,
        reworkDelta: 0,
        satisfiedReviewExpectation: true,
      })),
      recordReviewRejected: vi.fn(async () => ({
        matchedRuleType: 'review',
        nextExpectedActor: 'developer',
        nextExpectedAction: 'rework',
        requiresHumanApproval: false,
        reworkDelta: 1,
        satisfiedReviewExpectation: false,
      })),
    };

    await applyTaskCompletionSideEffects(
      eventService as never,
      undefined,
      workItemContinuityService as never,
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'agent-key',
      },
      {
        id: 'task-review',
        workflow_id: 'workflow-1',
        work_item_id: 'review-item',
        role: 'reviewer',
        stage_name: 'review',
        is_orchestrator_task: false,
        rework_count: 0,
        updated_at: 'updated',
        output: { verdict: 'request_changes' },
      },
      client as never,
    );

    expect(workItemContinuityService.recordTaskCompleted).not.toHaveBeenCalled();
    expect(workItemContinuityService.recordReviewRejected).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        id: 'task-review',
        work_item_id: 'review-item',
        role: 'reviewer',
      }),
      client,
    );
    expect(
      client.query.mock.calls.some(([sql]) => (sql as string).includes('INSERT INTO workflow_activations')),
    ).toBe(true);
  });

  it('requests rework on the reviewed task when a reviewer handoff requests changes', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("FROM tasks\n     WHERE tenant_id = $1 AND state = 'pending'")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('SELECT playbook_id FROM workflows')) {
          return { rows: [{ playbook_id: 'playbook-1' }], rowCount: 1 };
        }
        if (sql.includes('FROM task_handoffs')) {
          return {
            rows: [{
              completion: 'full',
              resolution: 'request_changes',
              review_outcome: null,
              summary: 'Add malformed-input regression coverage before approval.',
            }],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM tasks') && sql.includes("AND state = 'output_pending_review'") && sql.includes('AND id = $3')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-dev', 'task-review']);
          return {
            rows: [{
              id: 'task-dev',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'implementation-item',
              role: 'developer',
              state: 'output_pending_review',
              output: { summary: 'done' },
              metadata: {},
            }],
            rowCount: 1,
          };
        }
        if (sql.includes('INSERT INTO workflow_activations')) {
          return {
            rows: [{
              id: 'activation-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'task-completed:task-review:updated',
              reason: 'task.completed',
              event_type: 'task.completed',
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
    };
    const eventService = {
      emit: vi.fn(async () => undefined),
    };
    const workItemContinuityService = {
      recordTaskCompleted: vi.fn(async () => ({
        matchedRuleType: 'review',
        nextExpectedActor: 'live-test-developer',
        nextExpectedAction: 'rework',
        requiresHumanApproval: false,
        reworkDelta: 1,
        satisfiedReviewExpectation: false,
      })),
      recordReviewRejected: vi.fn(async () => ({
        matchedRuleType: 'review',
        nextExpectedActor: 'live-test-developer',
        nextExpectedAction: 'rework',
        requiresHumanApproval: false,
        reworkDelta: 1,
        satisfiedReviewExpectation: false,
      })),
    };
    const reviewTaskChangeService = {
      requestTaskChanges: vi.fn(async () => ({
        id: 'task-dev',
        state: 'ready',
        metadata: {
          review_action: 'request_changes',
          review_feedback: 'Add malformed-input regression coverage before approval.',
        },
      })),
    };

    await applyTaskCompletionSideEffects(
      eventService as never,
      undefined,
      workItemContinuityService as never,
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'agent-key',
      },
      {
        id: 'task-review',
        workflow_id: 'workflow-1',
        work_item_id: 'review-item',
        role: 'reviewer',
        stage_name: 'review',
        is_orchestrator_task: false,
        rework_count: 0,
        updated_at: 'updated',
        input: { developer_task_id: 'task-dev' },
        output: { verdict: 'request_changes' },
      },
      client as never,
      undefined,
      undefined,
      reviewTaskChangeService as never,
    );

    expect(reviewTaskChangeService.requestTaskChanges).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'task-dev',
      expect.objectContaining({
        feedback: 'Add malformed-input regression coverage before approval.',
      }),
      client,
    );
    expect(workItemContinuityService.recordReviewRejected).not.toHaveBeenCalled();
  });

  it('does not advance review continuity for a blocked reviewer handoff without a request-changes outcome', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("FROM tasks\n     WHERE tenant_id = $1 AND state = 'pending'")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('SELECT playbook_id FROM workflows')) {
          return { rows: [{ playbook_id: 'playbook-1' }], rowCount: 1 };
        }
        if (sql.includes('FROM task_handoffs')) {
          return {
            rows: [{
              completion: 'blocked',
              resolution: null,
            }],
            rowCount: 1,
          };
        }
        if (sql.includes('INSERT INTO workflow_activations')) {
          return {
            rows: [{
              id: 'activation-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'task-completed:task-review:updated',
              reason: 'task.completed',
              event_type: 'task.completed',
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
    };
    const eventService = {
      emit: vi.fn(async () => undefined),
    };
    const workItemContinuityService = {
      recordTaskCompleted: vi.fn(async () => ({
        matchedRuleType: 'review',
        nextExpectedActor: 'qa',
        nextExpectedAction: 'handoff',
        requiresHumanApproval: false,
        reworkDelta: 0,
        satisfiedReviewExpectation: true,
      })),
      recordReviewRejected: vi.fn(async () => ({
        matchedRuleType: 'review',
        nextExpectedActor: 'developer',
        nextExpectedAction: 'rework',
        requiresHumanApproval: false,
        reworkDelta: 1,
        satisfiedReviewExpectation: false,
      })),
    };

    await applyTaskCompletionSideEffects(
      eventService as never,
      undefined,
      workItemContinuityService as never,
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'agent-key',
      },
      {
        id: 'task-review',
        workflow_id: 'workflow-1',
        work_item_id: 'review-item',
        role: 'reviewer',
        stage_name: 'review',
        is_orchestrator_task: false,
        rework_count: 0,
        updated_at: 'updated',
        output: { verdict: 'approved' },
      },
      client as never,
    );

    expect(workItemContinuityService.recordTaskCompleted).not.toHaveBeenCalled();
    expect(workItemContinuityService.recordReviewRejected).not.toHaveBeenCalled();
    expect(
      client.query.mock.calls.some(([sql]) => (sql as string).includes('INSERT INTO workflow_activations')),
    ).toBe(true);
  });

  it('dispatches the completion activation immediately when a playbook task finishes', async () => {
    const activationDispatchService = {
      dispatchActivation: vi.fn(async () => 'orchestrator-task-1'),
    };
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("FROM tasks\n     WHERE tenant_id = $1 AND state = 'pending'")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('SELECT playbook_id FROM workflows')) {
          return { rows: [{ playbook_id: 'playbook-1' }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO workflow_activations')) {
          return {
            rows: [{
              id: 'activation-complete-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'task-completed:task-dev:updated',
              reason: 'task.completed',
              event_type: 'task.completed',
              payload: { task_id: 'task-dev' },
              state: 'queued',
              dispatch_attempt: 0,
              dispatch_token: null,
              queued_at: new Date('2026-03-17T12:00:00Z'),
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
    const eventService = {
      emit: vi.fn(async () => undefined),
    };
    const workItemContinuityService = {
      recordTaskCompleted: vi.fn(async () => ({
        matchedRuleType: 'handoff',
        nextExpectedActor: 'reviewer',
        nextExpectedAction: 'review',
        requiresHumanApproval: false,
        reworkDelta: 0,
        satisfiedReviewExpectation: false,
      })),
    };

    await applyTaskCompletionSideEffects(
      eventService as never,
      undefined,
      workItemContinuityService as never,
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'agent-key',
      },
      {
        id: 'task-dev',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        role: 'developer',
        stage_name: 'implementation',
        is_orchestrator_task: false,
        output: { summary: 'done' },
        updated_at: 'updated',
      },
      client as never,
      activationDispatchService as never,
    );

    expect(activationDispatchService.dispatchActivation).toHaveBeenCalledWith(
      'tenant-1',
      'activation-complete-1',
      client,
    );
  });

  it('treats late task completion activation enqueue as a no-op once the workflow is already completed', async () => {
    const activationDispatchService = {
      dispatchActivation: vi.fn(async () => 'orchestrator-task-1'),
    };
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("FROM tasks\n     WHERE tenant_id = $1 AND state = 'pending'")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('SELECT playbook_id FROM workflows')) {
          return { rows: [{ playbook_id: 'playbook-1' }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO workflow_activations')) {
          return {
            rows: [{
              id: 'activation-complete-noop',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'task-completed:task-dev:updated',
              reason: 'task.completed',
              event_type: 'task.completed',
              payload: { task_id: 'task-dev' },
              state: 'completed',
              dispatch_attempt: 0,
              dispatch_token: null,
              queued_at: new Date('2026-03-17T12:00:00Z'),
              started_at: null,
              consumed_at: new Date('2026-03-17T12:00:00Z'),
              completed_at: new Date('2026-03-17T12:00:00Z'),
              summary: 'Ignored activation because workflow is already completed.',
              error: null,
            }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    const eventService = {
      emit: vi.fn(async () => undefined),
    };
    const workItemContinuityService = {
      recordTaskCompleted: vi.fn(async () => ({
        matchedRuleType: 'handoff',
        nextExpectedActor: 'reviewer',
        nextExpectedAction: 'review',
        requiresHumanApproval: false,
        reworkDelta: 0,
        satisfiedReviewExpectation: false,
      })),
    };

    await applyTaskCompletionSideEffects(
      eventService as never,
      undefined,
      workItemContinuityService as never,
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'agent-key',
      },
      {
        id: 'task-dev',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        role: 'developer',
        stage_name: 'implementation',
        is_orchestrator_task: false,
        output: { summary: 'done' },
        updated_at: 'updated',
      },
      client as never,
      activationDispatchService as never,
    );

    expect(activationDispatchService.dispatchActivation).not.toHaveBeenCalled();
    expect(eventService.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'workflow.activation_queued' }),
      client,
    );
  });

  it('auto-completes the reviewed task across separate review work items using developer_task_id', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("FROM tasks\n     WHERE tenant_id = $1 AND state = 'pending'")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('SELECT playbook_id FROM workflows')) {
          return { rows: [{ playbook_id: 'playbook-1' }], rowCount: 1 };
        }
        if (sql.includes("AND state = 'output_pending_review'") && sql.includes('AND id = $3')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-dev', 'task-review']);
          return {
            rows: [{
              id: 'task-dev',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'implementation-item',
              role: 'developer',
              state: 'output_pending_review',
              output: { summary: 'done' },
              metadata: {},
            }],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM tasks') && sql.includes("AND state = 'output_pending_review'")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.startsWith('UPDATE tasks')) {
          return {
            rows: [{
              id: 'task-dev',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'implementation-item',
              workspace_id: 'workspace-1',
              role: 'developer',
              state: 'completed',
              output: { summary: 'done' },
              metadata: {
                review_action: 'approve_output',
                review_resolved_by_task_id: 'task-review',
              },
            }],
            rowCount: 1,
          };
        }
        if (sql.includes('INSERT INTO workflow_activations')) {
          return {
            rows: [{
              id: 'activation-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'task-completed:task-review:updated',
              reason: 'task.completed',
              event_type: 'task.completed',
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
        return { rows: [], rowCount: 1 };
      }),
    };
    const eventService = {
      emit: vi.fn(async () => undefined),
    };
    const workItemContinuityService = {
      recordTaskCompleted: vi.fn(async () => ({
        matchedRuleType: 'review',
        nextExpectedActor: 'qa',
        nextExpectedAction: 'handoff',
        requiresHumanApproval: false,
        reworkDelta: 0,
        satisfiedReviewExpectation: true,
      })),
    };

    await applyTaskCompletionSideEffects(
      eventService as never,
      undefined,
      workItemContinuityService as never,
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'agent-key',
      },
      {
        id: 'task-review',
        workflow_id: 'workflow-1',
        work_item_id: 'review-item',
        role: 'reviewer',
        stage_name: 'review',
        is_orchestrator_task: false,
        input: { developer_task_id: 'task-dev' },
        output: { verdict: 'approved' },
      },
      client as never,
    );

    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.state_changed',
        entityId: 'task-dev',
        actorId: 'review_resolver',
        data: expect.objectContaining({
          from_state: 'output_pending_review',
          to_state: 'completed',
          reason: 'output_review_approved',
          review_task_id: 'task-review',
        }),
      }),
      client,
    );
  });

  it('auto-closes a planned predecessor work item after review resolution completes its last open task', async () => {
    const eventService = {
      emit: vi.fn(async () => undefined),
    };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("FROM tasks\n     WHERE tenant_id = $1 AND state = 'pending'")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('SELECT playbook_id FROM workflows')) {
          return { rows: [{ playbook_id: 'playbook-1' }], rowCount: 1 };
        }
        if (sql.includes("AND state = 'output_pending_review'") && sql.includes('AND id = $3')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-dev', 'task-review']);
          return {
            rows: [{
              id: 'task-dev',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'implementation-item',
              role: 'developer',
              state: 'output_pending_review',
              output: { summary: 'done' },
              metadata: {},
            }],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          expect(params).toEqual(['tenant-1', 'workflow-1']);
          return {
            rows: [{
              lifecycle: 'planned',
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
                  { name: 'implementation', goal: 'Ship the change' },
                  { name: 'review', goal: 'Review the change' },
                ],
              },
            }],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('JOIN workflow_stages ws')) {
          if (params?.[2] === 'review-item') {
            return {
              rows: [{
                stage_name: 'review',
                column_id: 'planned',
                completed_at: null,
                human_gate: false,
                gate_status: 'not_requested',
              }],
              rowCount: 1,
            };
          }
          expect(params).toEqual(['tenant-1', 'workflow-1', 'implementation-item']);
          return {
            rows: [{
              stage_name: 'implementation',
              column_id: 'planned',
              completed_at: null,
              human_gate: false,
              gate_status: 'not_requested',
            }],
            rowCount: 1,
          };
        }
        if (sql.startsWith('SELECT id') && sql.includes('FROM workflow_work_items') && sql.includes('parent_work_item_id = $3')) {
          if (params?.[2] === 'review-item') {
            return {
              rows: [],
              rowCount: 0,
            };
          }
          expect(params).toEqual(['tenant-1', 'workflow-1', 'implementation-item', 'review']);
          return {
            rows: [{ id: 'review-item' }],
            rowCount: 1,
          };
        }
        if (sql.startsWith('SELECT COUNT(*)::int AS count') && sql.includes('FROM tasks')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'implementation-item']);
          return {
            rows: [{ count: 0 }],
            rowCount: 1,
          };
        }
        if (sql.startsWith('UPDATE tasks')) {
          return {
            rows: [{
              id: 'task-dev',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'implementation-item',
              workspace_id: 'workspace-1',
              role: 'developer',
              state: 'completed',
              output: { summary: 'done' },
              metadata: {
                review_action: 'approve_output',
                review_resolved_by_task_id: 'task-review',
              },
            }],
            rowCount: 1,
          };
        }
        if (sql.startsWith('UPDATE workflow_work_items')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'implementation-item',
            'done',
            expect.any(Date),
          ]);
          return {
            rows: [{ id: 'implementation-item' }],
            rowCount: 1,
          };
        }
        if (sql.includes('SELECT ws.id') && sql.includes('FROM workflow_stages ws')) {
          return {
            rows: [
              {
                id: 'stage-1',
                lifecycle: 'planned',
                name: 'implementation',
                position: 0,
                goal: 'Ship the change',
                guidance: null,
                human_gate: false,
                status: 'active',
                gate_status: 'not_requested',
                iteration_count: 0,
                summary: null,
                started_at: new Date('2026-03-19T18:00:00Z'),
                completed_at: null,
                open_work_item_count: 0,
                total_work_item_count: 1,
                first_work_item_at: new Date('2026-03-19T18:00:00Z'),
                last_completed_work_item_at: new Date('2026-03-19T18:10:00Z'),
              },
              {
                id: 'stage-2',
                lifecycle: 'planned',
                name: 'review',
                position: 1,
                goal: 'Review the change',
                guidance: null,
                human_gate: false,
                status: 'pending',
                gate_status: 'not_requested',
                iteration_count: 0,
                summary: null,
                started_at: null,
                completed_at: null,
                open_work_item_count: 1,
                total_work_item_count: 1,
                first_work_item_at: new Date('2026-03-19T18:11:00Z'),
                last_completed_work_item_at: null,
              },
            ],
            rowCount: 2,
          };
        }
        if (sql.includes('UPDATE workflow_stages')) {
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO workflow_activations')) {
          return {
            rows: [{
              id: 'activation-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'task-completed:task-review:updated',
              reason: 'task.completed',
              event_type: 'task.completed',
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
    };
    const workItemContinuityService = {
      recordTaskCompleted: vi.fn(async () => ({
        matchedRuleType: 'review',
        nextExpectedActor: 'qa',
        nextExpectedAction: 'handoff',
        requiresHumanApproval: false,
        reworkDelta: 0,
        satisfiedReviewExpectation: true,
      })),
    };

    await applyTaskCompletionSideEffects(
      eventService as never,
      undefined,
      workItemContinuityService as never,
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'agent-key',
      },
      {
        id: 'task-review',
        workflow_id: 'workflow-1',
        work_item_id: 'review-item',
        role: 'reviewer',
        stage_name: 'review',
        is_orchestrator_task: false,
        input: { developer_task_id: 'task-dev' },
        output: { verdict: 'approved' },
      },
      client as never,
    );

    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'work_item.completed',
        entityId: 'implementation-item',
        actorId: 'task_completion_side_effects',
      }),
      client,
    );
  });

  it('auto-completes the reviewed task across linked review work items using the parent work item fallback', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("FROM tasks\n     WHERE tenant_id = $1 AND state = 'pending'")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('SELECT playbook_id FROM workflows')) {
          return { rows: [{ playbook_id: 'playbook-1' }], rowCount: 1 };
        }
        if (sql.includes('FROM tasks') && sql.includes("AND state = 'output_pending_review'")) {
          if (params?.[2] === 'review-item') {
            return { rows: [], rowCount: 0 };
          }
          if (params?.[2] === 'implementation-item') {
            return {
              rows: [{
                id: 'task-dev',
                tenant_id: 'tenant-1',
                workflow_id: 'workflow-1',
                work_item_id: 'implementation-item',
                role: 'developer',
                state: 'output_pending_review',
                output: { summary: 'done' },
                metadata: {},
              }],
              rowCount: 1,
            };
          }
        }
        if (sql.includes('FROM workflow_work_items')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'review-item']);
          return {
            rows: [{ parent_work_item_id: 'implementation-item' }],
            rowCount: 1,
          };
        }
        if (sql.startsWith('UPDATE tasks')) {
          return {
            rows: [{
              id: 'task-dev',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'implementation-item',
              workspace_id: 'workspace-1',
              role: 'developer',
              state: 'completed',
              output: { summary: 'done' },
              metadata: {
                review_action: 'approve_output',
                review_resolved_by_task_id: 'task-review',
              },
            }],
            rowCount: 1,
          };
        }
        if (sql.includes('INSERT INTO workflow_activations')) {
          return {
            rows: [{
              id: 'activation-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'task-completed:task-review:updated',
              reason: 'task.completed',
              event_type: 'task.completed',
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
        return { rows: [], rowCount: 1 };
      }),
    };
    const eventService = {
      emit: vi.fn(async () => undefined),
    };
    const workItemContinuityService = {
      recordTaskCompleted: vi.fn(async () => ({
        matchedRuleType: 'review',
        nextExpectedActor: 'qa',
        nextExpectedAction: 'handoff',
        requiresHumanApproval: false,
        reworkDelta: 0,
        satisfiedReviewExpectation: true,
      })),
    };

    await applyTaskCompletionSideEffects(
      eventService as never,
      undefined,
      workItemContinuityService as never,
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'agent-key',
      },
      {
        id: 'task-review',
        workflow_id: 'workflow-1',
        work_item_id: 'review-item',
        role: 'reviewer',
        stage_name: 'review',
        is_orchestrator_task: false,
        input: {},
        output: { verdict: 'approved' },
      },
      client as never,
    );

    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.review_resolution_applied',
        entityId: 'task-review',
        actorId: 'review_resolver',
        data: expect.objectContaining({
          reviewed_task_id: 'task-dev',
          reviewed_work_item_id: 'implementation-item',
          resolution_source: 'parent_work_item',
          parent_work_item_id: 'implementation-item',
        }),
      }),
      client,
    );
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.state_changed',
        entityId: 'task-dev',
        actorId: 'review_resolver',
      }),
      client,
    );
  });

  it('auto-completes the reviewed task for a reviewer task even when continuity did not mark a review expectation', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("FROM tasks\n     WHERE tenant_id = $1 AND state = 'pending'")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('SELECT playbook_id FROM workflows')) {
          return { rows: [{ playbook_id: 'playbook-1' }], rowCount: 1 };
        }
        if (sql.includes('FROM tasks') && sql.includes("AND state = 'output_pending_review'") && sql.includes('AND id = $3')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-dev', 'task-review']);
          return {
            rows: [{
              id: 'task-dev',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'implementation-item',
              role: 'developer',
              state: 'output_pending_review',
              output: { summary: 'done' },
              metadata: {},
            }],
            rowCount: 1,
          };
        }
        if (sql.includes('INSERT INTO workflow_activations')) {
          return {
            rows: [{
              id: 'activation-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'task-completed:task-review:updated',
              reason: 'task.completed',
              event_type: 'task.completed',
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
        if (sql.startsWith('UPDATE tasks')) {
          return {
            rows: [{
              id: 'task-dev',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'implementation-item',
              workspace_id: 'workspace-1',
              role: 'developer',
              state: 'completed',
              output: { summary: 'done' },
              metadata: {
                review_action: 'approve_output',
                review_resolved_by_task_id: 'task-review',
              },
            }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 1 };
      }),
    };
    const eventService = {
      emit: vi.fn(async () => undefined),
    };
    const workItemContinuityService = {
      recordTaskCompleted: vi.fn(async () => ({
        matchedRuleType: 'handoff',
        nextExpectedActor: 'qa',
        nextExpectedAction: 'handoff',
        requiresHumanApproval: false,
        reworkDelta: 0,
        satisfiedReviewExpectation: false,
      })),
    };

    await applyTaskCompletionSideEffects(
      eventService as never,
      undefined,
      workItemContinuityService as never,
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'agent-key',
      },
      {
        id: 'task-review',
        workflow_id: 'workflow-1',
        work_item_id: 'review-item',
        role: 'reviewer',
        stage_name: 'review',
        is_orchestrator_task: false,
        input: { developer_task_id: 'task-dev' },
        metadata: { task_type: 'review' },
        output: { verdict: 'approved' },
      },
      client as never,
    );

    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.review_resolution_applied',
        entityId: 'task-review',
        actorId: 'review_resolver',
        data: expect.objectContaining({
          reviewed_task_id: 'task-dev',
          resolution_source: 'explicit_task',
          resolution_gate: 'explicit_reviewed_task_id',
        }),
      }),
      client,
    );
  });

  it('logs when review resolution is skipped before candidate lookup starts', async () => {
    const client = {
      query: vi.fn(async () => ({ rows: [{ playbook_id: 'playbook-1' }], rowCount: 1 })),
    };
    const eventService = {
      emit: vi.fn(async () => undefined),
    };
    const logService = {
      insert: vi.fn(async () => undefined),
    };
    const workItemContinuityService = {
      recordTaskCompleted: vi.fn(async () => ({
        matchedRuleType: 'handoff',
        nextExpectedActor: 'qa',
        nextExpectedAction: 'handoff',
        requiresHumanApproval: false,
        reworkDelta: 0,
        satisfiedReviewExpectation: false,
      })),
    };

    await applyTaskCompletionSideEffects(
      eventService as never,
      undefined,
      workItemContinuityService as never,
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'agent-key',
      },
      {
        id: 'task-dev',
        workflow_id: 'workflow-1',
        work_item_id: 'implementation-item',
        role: 'developer',
        stage_name: 'implementation',
        is_orchestrator_task: false,
        input: {},
        output: { summary: 'done' },
      },
      client as never,
      undefined,
      logService as never,
    );

    expect(logService.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'task.review_resolution.skipped',
        taskId: 'task-dev',
        workItemId: 'implementation-item',
        stageName: 'implementation',
        role: 'developer',
        payload: expect.objectContaining({
          event_type: 'task.review_resolution_skipped',
          reason: 'not_review_candidate',
          resolution_gate: 'not_review_candidate',
        }),
      }),
    );
  });
});
