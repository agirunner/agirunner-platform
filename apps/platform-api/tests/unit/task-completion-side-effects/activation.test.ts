import { describe, expect, it } from 'vitest';

import { applyTaskCompletionSideEffects } from '../../../src/services/task-completion-side-effects/task-completion-side-effects.js';
import { createClient, createCompletionTask, createContinuityService, createEventService, createIdentity } from './helpers.js';

describe('task completion activation side effects', () => {
  it('dispatches the completion activation immediately when no handoff exists', async () => {
    const eventService = createEventService();
    const client = createClient(async (sql: string) => {
      if (sql.includes("FROM tasks\n     WHERE tenant_id = $1 AND state = 'pending'")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('SELECT playbook_id FROM workflows')) {
        return { rows: [{ playbook_id: 'playbook-1' }], rowCount: 1 };
      }
      if (sql.includes('SELECT completion')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('INSERT INTO workflow_activations')) {
        return {
          rows: [{
            id: 'activation-1',
            workflow_id: 'workflow-1',
            activation_id: null,
            request_id: 'task-completed:task-complete:updated',
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
    });

    await applyTaskCompletionSideEffects(
      eventService as never,
      undefined,
      createContinuityService() as never,
      createIdentity() as never,
      createCompletionTask({
        id: 'task-complete',
        metadata: { task_kind: 'work' },
      }) as never,
      client as never,
    );

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO workflow_activations'),
      expect.any(Array),
    );
  });

  it('does not enqueue the completion activation when the task already submitted a handoff', async () => {
    const eventService = createEventService();
    const client = createClient(async (sql: string) => {
      if (sql.includes("FROM tasks\n     WHERE tenant_id = $1 AND state = 'pending'")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('SELECT playbook_id FROM workflows')) {
        return { rows: [{ playbook_id: 'playbook-1' }], rowCount: 1 };
      }
      if (sql.includes('SELECT completion')) {
        return {
          rows: [{
            completion: 'full',
            resolution: 'approved',
            summary: 'done',
            outcome_action_applied: null,
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    await applyTaskCompletionSideEffects(
      eventService as never,
      undefined,
      createContinuityService() as never,
      createIdentity() as never,
      createCompletionTask({
        id: 'task-complete',
        metadata: { task_kind: 'work' },
      }) as never,
      client as never,
    );

    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO workflow_activations'))).toBe(false);
  });
});
