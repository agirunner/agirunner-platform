import { describe, expect, it } from 'vitest';

import {
  normalizeTaskState,
  parseJsonObject,
  readCanonicalFinalDeliverables,
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

  it('reads canonical final deliverables from completion-style output packets', () => {
    expect(
      readCanonicalFinalDeliverables({
        summary: 'Workflow is complete.',
        final_artifacts: ['deliverables/release-notes.md', 'artifacts/result.json'],
      }),
    ).toEqual({
      summary: 'Workflow is complete.',
      deliverables: ['deliverables/release-notes.md', 'artifacts/result.json'],
    });

    expect(
      readCanonicalFinalDeliverables({
        summary: 'Workflow is complete.',
        final_artifacts: ['deliverables/release-notes.md', '', 42],
      }),
    ).toEqual({
      summary: 'Workflow is complete.',
      deliverables: ['deliverables/release-notes.md'],
    });

    expect(readCanonicalFinalDeliverables({ final_artifacts: [] })).toBeNull();
    expect(readCanonicalFinalDeliverables('plain text output')).toBeNull();
  });
});
