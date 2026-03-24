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
  void input;

  return {
    matchedRuleType: null,
    nextExpectedActor: null,
    nextExpectedAction: null,
    requiresHumanApproval: false,
    reworkDelta: 0,
  };
}
