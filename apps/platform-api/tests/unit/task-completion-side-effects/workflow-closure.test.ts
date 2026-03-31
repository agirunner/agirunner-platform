import { describe, expect, it } from 'vitest';

import { applyTaskCompletionSideEffects } from '../../../src/services/task-completion-side-effects.js';
import {
  createAssessmentTask,
  createClient,
  createContinuityService,
  createEventService,
  createIdentity,
} from './helpers.js';

describe('task completion workflow closure', () => {
  it('auto-closes an ongoing work item after an approved assessment settles the last remaining work', async () => {
    const eventService = createEventService();
    const client = createClient(async (sql: string) => {
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
            resolution: 'approved',
            summary: 'done',
            outcome_action_applied: null,
          }],
          rowCount: 1,
        };
      }
      if (sql.includes('SELECT w.lifecycle')) {
        return {
          rows: [{
            lifecycle: 'ongoing',
            definition: {
              roles: [],
              board: {
                entry_column_id: 'in_progress',
                columns: [
                  { id: 'in_progress', label: 'In Progress' },
                  { id: 'done', label: 'Done', is_terminal: true },
                ],
              },
              stages: [],
              lifecycle: 'ongoing',
            },
          }],
          rowCount: 1,
        };
      }
      if (sql.includes('SELECT wi.stage_name')) {
        return {
          rows: [{
            stage_name: 'implementation',
            column_id: 'in_progress',
            completed_at: null,
            blocked_state: null,
            escalation_status: null,
            next_expected_actor: null,
            next_expected_action: null,
          }],
          rowCount: 1,
        };
      }
      if (sql.includes('SELECT COUNT(*)::int AS count')) {
        return { rows: [{ count: 0 }], rowCount: 1 };
      }
      if (sql.startsWith('UPDATE workflow_work_items')) {
        return { rows: [{ id: 'work-item-1' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    await applyTaskCompletionSideEffects(
      eventService as never,
      undefined,
      createContinuityService() as never,
      createIdentity() as never,
      createAssessmentTask({
        output: { verdict: 'approved' },
      }) as never,
      client as never,
    );

    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'work_item.completed',
        entityId: 'review-item',
      }),
      client,
    );
  });

  it('does not auto-close the work item when unfinished tasks remain', async () => {
    const eventService = createEventService();
    const client = createClient(async (sql: string) => {
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
            resolution: 'approved',
            summary: 'done',
            outcome_action_applied: null,
          }],
          rowCount: 1,
        };
      }
      if (sql.includes('SELECT w.lifecycle')) {
        return {
          rows: [{
            lifecycle: 'ongoing',
            definition: {
              roles: [],
              board: {
                entry_column_id: 'in_progress',
                columns: [
                  { id: 'in_progress', label: 'In Progress' },
                  { id: 'done', label: 'Done', is_terminal: true },
                ],
              },
              stages: [],
              lifecycle: 'ongoing',
            },
          }],
          rowCount: 1,
        };
      }
      if (sql.includes('SELECT wi.stage_name')) {
        return {
          rows: [{
            stage_name: 'implementation',
            column_id: 'in_progress',
            completed_at: null,
            blocked_state: null,
            escalation_status: null,
            next_expected_actor: null,
            next_expected_action: null,
          }],
          rowCount: 1,
        };
      }
      if (sql.includes('SELECT COUNT(*)::int AS count')) {
        return { rows: [{ count: 1 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    await applyTaskCompletionSideEffects(
      eventService as never,
      undefined,
      createContinuityService() as never,
      createIdentity() as never,
      createAssessmentTask({
        output: { verdict: 'approved' },
      }) as never,
      client as never,
    );

    expect(
      eventService.emit.mock.calls.some((call) => (call[0] as { type?: string }).type === 'work_item.completed'),
    ).toBe(false);
  });
});
