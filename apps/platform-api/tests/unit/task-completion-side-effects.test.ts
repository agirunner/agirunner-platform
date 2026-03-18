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
});
