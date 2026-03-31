import type { PlaybookDefinition } from '../../orchestration/playbook-model.js';

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
  if (input.decisionState === 'blocked') {
    return { action: 'block_subject' } satisfies AssessmentOutcomeAction;
  }
  return null as AssessmentOutcomeAction | null;
}
