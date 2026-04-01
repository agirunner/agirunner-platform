import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/services/safetynet/logging.js', () => ({
  logSafetynetTriggered: vi.fn(),
}));

import { applyTaskCompletionSideEffects } from '../../../src/services/task-completion-side-effects/task-completion-side-effects.js';
import { logSafetynetTriggered } from '../../../src/services/safetynet/logging.js';
import { PLATFORM_TASK_COMPLETION_APPROVED_ONGOING_WORK_ITEM_AUTO_CLOSE_ID } from '../../../src/services/safetynet/registry.js';
import {
  createAssessmentTask,
  createClient,
  createContinuityService,
  createEventService,
  createIdentity,
} from './helpers.js';

describe('task completion workflow closure', () => {
  beforeEach(() => {
    vi.mocked(logSafetynetTriggered).mockReset();
  });

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
    expect(logSafetynetTriggered).toHaveBeenCalledWith(
      expect.objectContaining({
        id: PLATFORM_TASK_COMPLETION_APPROVED_ONGOING_WORK_ITEM_AUTO_CLOSE_ID,
      }),
      'platform auto-closed an ongoing work item after an approved assessment settled the final remaining work',
      expect.objectContaining({
        workflow_id: 'workflow-1',
        work_item_id: 'review-item',
        task_id: 'task-review',
        stage_name: 'implementation',
      }),
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

    const eventCalls = eventService.emit.mock.calls as unknown as Array<[
      { type?: string },
      ...unknown[],
    ]>;
    expect(eventCalls.some(([event]) => event.type === 'work_item.completed')).toBe(false);
    expect(logSafetynetTriggered).not.toHaveBeenCalled();
  });
});
