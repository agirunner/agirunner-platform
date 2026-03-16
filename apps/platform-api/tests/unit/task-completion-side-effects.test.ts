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
        if (sql.includes("AND state = 'output_pending_review'")) {
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
              project_id: 'project-1',
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
});
