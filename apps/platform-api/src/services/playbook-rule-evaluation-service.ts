import type { PlaybookDefinition } from '../orchestration/playbook-model.js';

export type PlaybookRuleEvent =
  | 'task_completed'
  | 'review_rejected'
  | 'review_approved'
  | 'checkpoint_reached'
  | 'completion_requested';

export interface EvaluatePlaybookRulesInput {
  definition: PlaybookDefinition;
  event: PlaybookRuleEvent;
  role: string;
  checkpointName?: string | null;
}

export interface PlaybookRuleEvaluationResult {
  matchedRuleType: 'review' | 'approval' | 'handoff' | null;
  nextExpectedActor: string | 'human' | null;
  nextExpectedAction: 'review' | 'rework' | 'approve' | 'handoff' | null;
  requiresHumanApproval: boolean;
  reworkDelta: number;
}

export function evaluatePlaybookRules(
  input: EvaluatePlaybookRulesInput,
): PlaybookRuleEvaluationResult {
  const reviewResult = evaluateReviewRule(input);
  if (reviewResult) {
    return reviewResult;
  }

  const approvalResult = evaluateApprovalRule(input);
  if (approvalResult) {
    return approvalResult;
  }

  const handoffResult = evaluateHandoffRule(input);
  if (handoffResult) {
    return handoffResult;
  }

  return {
    matchedRuleType: null,
    nextExpectedActor: null,
    nextExpectedAction: null,
    requiresHumanApproval: false,
    reworkDelta: 0,
  };
}

function evaluateReviewRule(
  input: EvaluatePlaybookRulesInput,
): PlaybookRuleEvaluationResult | null {
  const rule = input.definition.review_rules.find(
    (candidate) =>
      candidate.required !== false
      && candidate.from_role === input.role
      && matchesCheckpoint(candidate.checkpoint, input.checkpointName),
  );
  if (!rule) {
    return null;
  }

  if (input.event === 'task_completed') {
    return {
      matchedRuleType: 'review',
      nextExpectedActor: rule.reviewed_by,
      nextExpectedAction: 'review',
      requiresHumanApproval: false,
      reworkDelta: 0,
    };
  }

  if (input.event === 'review_rejected' && rule.on_reject?.action === 'return_to_role') {
    return {
      matchedRuleType: 'review',
      nextExpectedActor: rule.on_reject.role,
      nextExpectedAction: 'rework',
      requiresHumanApproval: false,
      reworkDelta: 1,
    };
  }

  return null;
}

function evaluateApprovalRule(
  input: EvaluatePlaybookRulesInput,
): PlaybookRuleEvaluationResult | null {
  const rule = input.definition.approval_rules.find((candidate) => {
    if (candidate.required === false) {
      return false;
    }
    if (candidate.on === 'completion') {
      return input.event === 'completion_requested';
    }
    return (
      input.event === 'checkpoint_reached' &&
      candidate.checkpoint === input.checkpointName
    );
  });
  if (!rule) {
    return null;
  }

  return {
    matchedRuleType: 'approval',
    nextExpectedActor: 'human',
    nextExpectedAction: 'approve',
    requiresHumanApproval: true,
    reworkDelta: 0,
  };
}

function evaluateHandoffRule(
  input: EvaluatePlaybookRulesInput,
): PlaybookRuleEvaluationResult | null {
  if (input.event !== 'task_completed') {
    return null;
  }
  if (input.definition.lifecycle === 'planned') {
    return null;
  }

  const rule = input.definition.handoff_rules.find(
    (candidate) =>
      candidate.required !== false
      && candidate.from_role === input.role
      && matchesCheckpoint(candidate.checkpoint, input.checkpointName),
  );
  if (!rule) {
    return null;
  }

  return {
    matchedRuleType: 'handoff',
    nextExpectedActor: rule.to_role,
    nextExpectedAction: 'handoff',
    requiresHumanApproval: false,
    reworkDelta: 0,
  };
}

function matchesCheckpoint(
  ruleCheckpoint: string | null | undefined,
  currentCheckpoint: string | null | undefined,
) {
  if (!ruleCheckpoint) {
    return true;
  }
  return ruleCheckpoint === (currentCheckpoint ?? null);
}
