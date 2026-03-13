export type FeedbackActionKind =
  | 'request_rework'
  | 'bypass_step'
  | 'reject_step'
  | 'bypass_review'
  | 'reject_output'
  | 'resume_guidance';

interface FeedbackRule {
  minimumLength: number;
  missingMessage: string;
  shortMessage: string;
  recoveryHints: string[];
}

const FEEDBACK_RULES: Record<FeedbackActionKind, FeedbackRule> = {
  request_rework: {
    minimumLength: 16,
    missingMessage: 'Describe what needs to change before the specialist step should continue.',
    shortMessage:
      'Rework feedback must explain what to change and what good output should look like.',
    recoveryHints: [
      'Call out the missing or incorrect part of the current output.',
      'State what evidence, artifact, or behavior should change on the next run.',
    ],
  },
  bypass_step: {
    minimumLength: 12,
    missingMessage: 'Explain why this step can be bypassed safely.',
    shortMessage:
      'Bypass reasons must explain why skipping the step will not put the workflow at risk.',
    recoveryHints: [
      'State why the step is no longer needed or already satisfied elsewhere.',
      'Mention any follow-up risk the operator still expects downstream.',
    ],
  },
  reject_step: {
    minimumLength: 16,
    missingMessage: 'Explain why the specialist step is being rejected.',
    shortMessage:
      'Reject feedback must explain the failure clearly enough for later diagnosis.',
    recoveryHints: [
      'Name the blocking defect or policy violation.',
      'State whether the work should be retried elsewhere or abandoned.',
    ],
  },
  bypass_review: {
    minimumLength: 12,
    missingMessage: 'Explain why this output gate can be bypassed safely.',
    shortMessage:
      'Bypass review reasons must explain why the quality gate is safe to skip.',
    recoveryHints: [
      'State why the review is redundant or already covered.',
      'Call out any remaining risk the operator is consciously accepting.',
    ],
  },
  reject_output: {
    minimumLength: 16,
    missingMessage: 'Explain why the output is being rejected.',
    shortMessage:
      'Reject output feedback must describe what failed and what must change before acceptance.',
    recoveryHints: [
      'Call out the broken output, missing evidence, or quality issue.',
      'Explain what the next specialist iteration must improve.',
    ],
  },
  resume_guidance: {
    minimumLength: 16,
    missingMessage: 'Provide operator guidance so the specialist can continue.',
    shortMessage:
      'Guidance must include a concrete next step or decision, not only encouragement.',
    recoveryHints: [
      'Answer the blocking question directly.',
      'Give the specialist the next decision, constraint, or source of truth to follow.',
    ],
  },
};

export function validateFeedbackDraft(
  kind: FeedbackActionKind,
  value: string,
): string | null {
  const trimmed = value.trim();
  const rule = FEEDBACK_RULES[kind];
  if (trimmed.length === 0) {
    return rule.missingMessage;
  }
  if (trimmed.length < rule.minimumLength) {
    return rule.shortMessage;
  }
  return null;
}

export function listFeedbackRecoveryHints(
  kind: FeedbackActionKind,
): string[] {
  return FEEDBACK_RULES[kind].recoveryHints;
}
