import { describe, expect, it } from 'vitest';

import {
  buildTaskNextStep,
  normalizeTaskState,
  parseJsonObject,
  readClarificationAnswers,
  readClarificationHistory,
  readAssessmentSignals,
  readHumanEscalationResponse,
  readReworkDetails,
} from './task-detail-support.js';

describe('task detail lifecycle support', () => {
  it('parses JSON object inputs for task actions', () => {
    expect(parseJsonObject('{"force":true}', 'bad')).toEqual({
      value: { force: true },
      error: null,
    });
    expect(parseJsonObject('[]', 'bad').error).toBe('bad');
  });

  it('keeps task lifecycle labels canonical for the operator surface', () => {
    expect(normalizeTaskState('in_progress')).toBe('in_progress');
    expect(normalizeTaskState('escalated')).toBe('escalated');
    expect(normalizeTaskState('awaiting_approval')).toBe('awaiting_approval');
    expect(normalizeTaskState('running')).toBe('running');
    expect(normalizeTaskState('awaiting_escalation')).toBe('awaiting_escalation');
  });

  it('reads clarification history and answers from task input', () => {
    const task = {
      input: {
        clarification_answers: { scope: 'phase-2' },
        clarification_history: [
          {
            feedback: 'Need target users',
            answered_at: '2026-03-07T00:00:00Z',
            answered_by: 'admin',
            answers: { target_users: 'operators' },
          },
        ],
      },
    };

    expect(readClarificationAnswers(task as never)).toEqual({ scope: 'phase-2' });
    expect(readClarificationHistory(task as never)).toEqual([
      {
        feedback: 'Need target users',
        answered_at: '2026-03-07T00:00:00Z',
        answered_by: 'admin',
        answers: { target_users: 'operators' },
      },
    ]);
  });

  it('reads rework and human escalation metadata', () => {
    const task = {
      rework_count: 2,
      metadata: {
        assessment_action: 'request_changes',
        assessment_feedback: 'Tighten the plan',
        clarification_requested: true,
        assessment_updated_at: '2026-03-08T12:00:00Z',
        escalation_reason: 'Need rollout approval',
        escalation_target: 'human',
        escalation_context: 'Waiting for change window',
        escalation_awaiting_human: true,
      },
      input: {
        human_escalation_response: {
          instructions: 'Use the approved rollout window.',
        },
      },
    };

    expect(readReworkDetails(task as never)).toEqual({
      reworkCount: 2,
      assessmentAction: 'request_changes',
      assessmentFeedback: 'Tighten the plan',
      clarificationRequested: true,
    });
    expect(readHumanEscalationResponse(task as never)).toEqual({
      instructions: 'Use the approved rollout window.',
    });
    expect(readAssessmentSignals(task as never)).toEqual({
      assessmentAction: 'request_changes',
      assessmentFeedback: 'Tighten the plan',
      assessmentUpdatedAt: '2026-03-08T12:00:00Z',
      escalationReason: 'Need rollout approval',
      escalationTarget: 'human',
      escalationContext: 'Waiting for change window',
      escalationAwaitingHuman: true,
    });
  });

  it('builds operator next-step guidance from canonical task state', () => {
    expect(buildTaskNextStep({ state: 'awaiting_approval' } as never)).toEqual({
      title: 'Approve or reject this specialist step',
      detail:
        'Review the work-item packet, decide whether the step should advance, and keep the board state aligned with the operator decision.',
    });
    expect(buildTaskNextStep({ status: 'failed' } as never).title).toBe(
      'Inspect failure context before retrying',
    );
    expect(buildTaskNextStep({ state: 'in_progress' } as never).title).toBe(
      'Monitor execution and intervene only if needed',
    );
    expect(buildTaskNextStep({ state: 'queued' } as never).detail).toBe(
      'Use the workflow scope, current status, and step packet to decide the safest next operator action.',
    );
  });
});
