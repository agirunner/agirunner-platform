import { describe, expect, it } from 'vitest';

import {
  normalizeTaskState,
  parseJsonObject,
  readClarificationAnswers,
  readClarificationHistory,
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

  it('normalizes legacy task lifecycle labels to v2 operator language', () => {
    expect(normalizeTaskState('running')).toBe('in_progress');
    expect(normalizeTaskState('claimed')).toBe('in_progress');
    expect(normalizeTaskState('awaiting_escalation')).toBe('escalated');
    expect(normalizeTaskState('awaiting_approval')).toBe('awaiting_approval');
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
        review_action: 'request_changes',
        review_feedback: 'Tighten the plan',
        clarification_requested: true,
      },
      input: {
        human_escalation_response: {
          instructions: 'Use the approved rollout window.',
        },
      },
    };

    expect(readReworkDetails(task as never)).toEqual({
      reworkCount: 2,
      reviewAction: 'request_changes',
      reviewFeedback: 'Tighten the plan',
      clarificationRequested: true,
    });
    expect(readHumanEscalationResponse(task as never)).toEqual({
      instructions: 'Use the approved rollout window.',
    });
  });
});
