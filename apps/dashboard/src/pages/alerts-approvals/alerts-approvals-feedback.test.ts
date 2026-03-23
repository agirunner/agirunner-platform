import { describe, expect, it } from 'vitest';

import {
  listFeedbackRecoveryHints,
  validateFeedbackDraft,
} from './alerts-approvals-feedback.js';

describe('alerts approvals feedback support', () => {
  it('requires meaningful rework and rejection feedback', () => {
    expect(validateFeedbackDraft('request_rework', '')).toContain(
      'Describe what needs to change',
    );
    expect(validateFeedbackDraft('request_rework', 'Needs work')).toContain(
      'must explain what to change',
    );
    expect(validateFeedbackDraft('reject_output', 'Bad')).toContain(
      'must describe what failed',
    );
    expect(
      validateFeedbackDraft(
        'reject_output',
        'The output is missing the release checklist and deployment evidence.',
      ),
    ).toBeNull();
  });

  it('requires actionable operator guidance for escalations', () => {
    expect(validateFeedbackDraft('resume_guidance', '')).toContain(
      'Provide operator guidance',
    );
    expect(validateFeedbackDraft('resume_guidance', 'Keep going')).toContain(
      'concrete next step or decision',
    );
    expect(
      validateFeedbackDraft(
        'resume_guidance',
        'Use the payment service contract in docs/api.md and keep the retry window at 30 seconds.',
      ),
    ).toBeNull();
  });

  it('exposes recovery hints for bypass and review decisions', () => {
    expect(listFeedbackRecoveryHints('bypass_step')).toEqual([
      'State why the step is no longer needed or already satisfied elsewhere.',
      'Mention any follow-up risk the operator still expects downstream.',
    ]);
    expect(listFeedbackRecoveryHints('reject_step')).toContain(
      'Name the blocking defect or policy violation.',
    );
  });
});
