import type { PlaybookDefinition } from '../orchestration/playbook-model.js';
import { resolveAssessmentExpectation } from './playbook-approval-ordering.js';

export type PlaybookRuleEvent =
  | 'task_completed'
  | 'assessment_requested_changes'
  | 'checkpoint_reached'
  | 'completion_requested';

export interface EvaluatePlaybookRulesInput {
  definition: PlaybookDefinition;
  event: PlaybookRuleEvent;
  role: string;
  checkpointName?: string | null;
  decisionState?: 'approved' | 'request_changes' | 'rejected' | 'blocked' | null;
}

export interface PlaybookRuleEvaluationResult {
  matchedRuleType: 'assessment' | 'approval' | 'handoff' | null;
  nextExpectedActor: string | 'human' | null;
  nextExpectedAction: 'assess' | 'rework' | 'approve' | 'handoff' | null;
  requiresHumanApproval: boolean;
  reworkDelta: number;
}

export function evaluatePlaybookRules(
  input: EvaluatePlaybookRulesInput,
): PlaybookRuleEvaluationResult {
  const assessmentResult = evaluateAssessmentRule(input);
  if (assessmentResult) {
    return assessmentResult;
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

function evaluateAssessmentRule(
  input: EvaluatePlaybookRulesInput,
): PlaybookRuleEvaluationResult | null {
  const expectation = resolveAssessmentExpectation(
    input.definition,
    input.role,
    input.checkpointName ?? null,
  );
  if (!expectation) {
    return null;
  }

  if (input.event === 'task_completed') {
    return {
      matchedRuleType: 'assessment',
      nextExpectedActor: expectation.nextExpectedActor,
      nextExpectedAction: 'assess',
      requiresHumanApproval: false,
      reworkDelta: 0,
    };
  }

  const rule = input.definition.assessment_rules.find(
    (candidate) =>
      candidate.required !== false
      && candidate.subject_role === input.role
      && matchesCheckpoint(candidate.checkpoint, input.checkpointName),
  );
  if (!rule) {
    return null;
  }

  const decisionState = input.decisionState ?? 'request_changes';
  const requestChanges = rule.outcome_actions?.[decisionState];
  if (
    input.event === 'assessment_requested_changes' &&
    requestChanges?.action === 'route_to_role' &&
    requestChanges.role
  ) {
    return {
      matchedRuleType: 'assessment',
      nextExpectedActor: requestChanges.role,
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
  const rule = input.definition.handoff_rules.find(
    (candidate) =>
      candidate.required !== false
      && candidate.from_role === input.role
      && matchesCheckpoint(candidate.checkpoint, input.checkpointName),
  );
  if (!rule) {
    return null;
  }
  if (
    input.definition.lifecycle === 'planned'
    && !isPlannedIntraStageHandoff(input.definition, input.checkpointName, rule.from_role, rule.to_role)
  ) {
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

function isPlannedIntraStageHandoff(
  definition: PlaybookDefinition,
  checkpointName: string | null | undefined,
  fromRole: string,
  toRole: string,
) {
  if (!checkpointName) {
    return false;
  }
  const stage = definition.stages.find((entry) => entry.name === checkpointName);
  const stageRoles = stage?.involves?.filter((role) => role.trim().length > 0) ?? [];
  return stageRoles.includes(fromRole) && stageRoles.includes(toRole);
}
