import { describe, expect, it, vi } from 'vitest';

import { applyTaskCompletionSideEffects } from '../../../src/services/task-completion-side-effects/task-completion-side-effects.js';
import {
  createAssessmentTask,
  createClient,
  createContinuityService,
  createEventService,
  createIdentity,
} from './helpers.js';

describe('task completion assessment resolution', () => {
  it('auto-completes the subject task when an assessment expectation is satisfied', async () => {
    const eventService = createEventService();
    const continuityService = createContinuityService();
    continuityService.recordTaskCompleted = vi.fn(async () => ({
      matchedRuleType: 'handoff',
      nextExpectedActor: 'qa',
      nextExpectedAction: 'handoff',
      requiresHumanApproval: false,
      reworkDelta: 0,
      satisfiedAssessmentExpectation: true,
    }));

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
      if (sql.includes("AND state = 'output_pending_assessment'")) {
        return {
          rows: [{
            id: 'task-dev',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            role: 'developer',
            state: 'output_pending_assessment',
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
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
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
        output: { verdict: 'approved' },
      }) as never,
      client as never,
    );

    expect(continuityService.recordTaskCompleted).toHaveBeenCalled();
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.state_changed',
        entityId: 'task-dev',
        actorId: 'assessment_resolver',
        data: expect.objectContaining({
          from_state: 'output_pending_assessment',
          to_state: 'completed',
          reason: 'assessment_approved',
          assessment_task_id: 'task-review',
        }),
      }),
      client,
    );
  });

  it('skips assessment resolution when the subject task linkage is missing', async () => {
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
      return { rows: [], rowCount: 0 };
    });

    await applyTaskCompletionSideEffects(
      eventService as never,
      undefined,
      createContinuityService() as never,
      createIdentity() as never,
      createAssessmentTask({
        metadata: { task_kind: 'assessment' },
        input: { subject_work_item_id: 'work-item-1', subject_revision: 1 },
        output: { verdict: 'approved' },
      }) as never,
      client as never,
    );

    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.assessment_resolution_skipped',
        actorId: 'assessment_resolver',
        data: expect.objectContaining({
          reason: 'missing_subject_task_id',
          resolution_gate: 'missing_subject_task_id',
        }),
      }),
      client,
    );
  });
});
