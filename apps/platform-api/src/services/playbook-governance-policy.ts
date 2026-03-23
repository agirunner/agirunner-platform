import type { PlaybookDefinition } from '../orchestration/playbook-model.js';

type DecisionState = 'approved' | 'request_changes' | 'rejected' | 'blocked';

interface AssessmentOutcomeAction {
  action: 'continue' | 'reopen_subject' | 'route_to_role' | 'block_subject' | 'escalate' | 'terminate_branch';
  role?: string;
}

export function resolveAssessmentOutcomeAction(input: {
  definition: PlaybookDefinition;
  subjectRole: string | null;
  assessorRole: string | null;
  checkpointName?: string | null;
  decisionState: DecisionState;
}) {
  if (!input.subjectRole || !input.assessorRole) {
    return null;
  }

  const matchedRule = input.definition.assessment_rules.find((rule) =>
    rule.subject_role === input.subjectRole
    && rule.assessed_by === input.assessorRole
    && matchesCheckpoint(rule.checkpoint, input.checkpointName)
    && decisionStateIsAllowed(rule.decision_states, input.decisionState),
  );
  if (!matchedRule) {
    return null;
  }

  return (matchedRule.outcome_actions?.[input.decisionState] ?? null) as AssessmentOutcomeAction | null;
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

function decisionStateIsAllowed(
  allowedStates: DecisionState[] | undefined,
  decisionState: DecisionState,
) {
  if (!Array.isArray(allowedStates) || allowedStates.length === 0) {
    return decisionState !== 'blocked';
  }
  return allowedStates.includes(decisionState);
}
