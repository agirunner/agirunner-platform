import { describe, expect, it, vi } from 'vitest';

import { applyTaskCompletionSideEffects } from '../../../src/services/task-completion-side-effects.js';
import {
  createAssessmentTask,
  createClient,
  createContinuityService,
  createEventService,
  createIdentity,
} from './helpers.js';

describe('task completion assessment actions', () => {
  it('requests rework on the explicit subject task when an assessment handoff requests changes', async () => {
    const eventService = createEventService();
    const continuityService = createContinuityService();
    const reviewTaskChangeService = {
      requestTaskChanges: vi.fn(async () => ({ id: 'task-dev' })),
    };
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
            resolution: 'request_changes',
            summary: 'Add malformed-input regression coverage before approval.',
            outcome_action_applied: null,
          }],
          rowCount: 1,
        };
      }
      if (sql.includes('FROM tasks') && sql.includes('state = ANY($4::task_state[])')) {
        return {
          rows: [{
            id: 'task-dev',
            workflow_id: 'workflow-1',
            work_item_id: 'implementation-item',
            role: 'developer',
            state: 'output_pending_assessment',
            output: { summary: 'done' },
            metadata: {},
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    await applyTaskCompletionSideEffects(
      eventService as never,
      undefined,
      continuityService as never,
      createIdentity() as never,
      createAssessmentTask({
        output: { verdict: 'request_changes' },
      }) as never,
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
    expect(continuityService.recordAssessmentRequestedChanges).not.toHaveBeenCalled();
  });

  it('rejects the explicit subject task when an assessment handoff rejects it', async () => {
    const eventService = createEventService();
    const continuityService = createContinuityService();
    const reviewTaskChangeService = {
      rejectTask: vi.fn(async () => ({ id: 'task-dev' })),
    };
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
            resolution: 'rejected',
            summary: 'QA found a regression in greeting validation.',
            outcome_action_applied: null,
          }],
          rowCount: 1,
        };
      }
      if (sql.includes('FROM tasks') && sql.includes('state = ANY($4::task_state[])')) {
        return {
          rows: [{
            id: 'task-dev',
            workflow_id: 'workflow-1',
            work_item_id: 'implementation-item',
            role: 'developer',
            state: 'completed',
            output: { summary: 'done' },
            metadata: {},
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    await applyTaskCompletionSideEffects(
      eventService as never,
      undefined,
      continuityService as never,
      createIdentity() as never,
      createAssessmentTask({
        id: 'task-review',
        work_item_id: 'review-item',
        output: { verdict: 'rejected' },
      }) as never,
      client as never,
      undefined,
      undefined,
      reviewTaskChangeService as never,
    );

    expect(reviewTaskChangeService.rejectTask).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'task-dev',
      expect.objectContaining({
        feedback: 'QA found a regression in greeting validation.',
        record_continuity: false,
      }),
      client,
    );
    expect(continuityService.recordTaskCompleted).toHaveBeenCalled();
  });

  it('applies the explicit block_subject action for a blocked assessment handoff', async () => {
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
            resolution: 'blocked',
            summary: 'Block the subject work item.',
            outcome_action_applied: 'block_subject',
          }],
          rowCount: 1,
        };
      }
      if (sql.includes('SELECT p.definition')) {
        return {
          rows: [{
            definition: {
              roles: [],
              board: {
                entry_column_id: 'backlog',
                columns: [
                  { id: 'backlog', label: 'Backlog' },
                  { id: 'blocked', label: 'Blocked', is_blocked: true },
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
      if (sql.includes('FROM tasks') && sql.includes('state = ANY($4::task_state[])')) {
        return {
          rows: [{
            id: 'task-dev',
            workflow_id: 'workflow-1',
            work_item_id: 'implementation-item',
            role: 'developer',
            state: 'output_pending_assessment',
            output: { summary: 'done' },
            metadata: {},
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
      createAssessmentTask({
        output: { verdict: 'blocked' },
      }) as never,
      client as never,
    );

    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.assessment_block_applied',
        actorId: 'assessment_resolver',
      }),
      client,
    );
  });
});
