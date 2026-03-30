interface WorkflowControlStateInput {
  state?: string | null;
  workflowPosture?: string | null;
  availableActions?: Array<{
    kind: string;
    scope?: string;
    enabled: boolean;
  }>;
}

export interface WorkflowControlAvailability {
  canPause: boolean;
  canResume: boolean;
  canCancel: boolean;
}

export function getWorkflowControlAvailability(
  input: WorkflowControlStateInput,
): WorkflowControlAvailability {
  const actionAvailability = readWorkflowActionAvailability(input.availableActions);
  if (actionAvailability) {
    return actionAvailability;
  }

  const state = input.state?.trim().toLowerCase() ?? '';
  const posture = input.workflowPosture?.trim().toLowerCase() ?? '';
  const isCancelling = posture === 'cancelling';
  return {
    canPause: state === 'active' && !isCancelling,
    canResume: state === 'paused' && !isCancelling,
    canCancel: (state === 'active' || state === 'paused') && !isCancelling,
  };
}

function readWorkflowActionAvailability(
  availableActions: WorkflowControlStateInput['availableActions'],
): WorkflowControlAvailability | null {
  if (!availableActions || availableActions.length === 0) {
    return null;
  }
  const workflowActions = availableActions.filter(
    (entry) => (entry.scope?.trim().toLowerCase() ?? 'workflow') === 'workflow',
  );
  if (workflowActions.length === 0) {
    return {
      canPause: false,
      canResume: false,
      canCancel: false,
    };
  }
  const lifecycleKinds = new Set([
    'pause_workflow',
    'resume_workflow',
    'cancel_workflow',
  ]);
  if (!workflowActions.some((entry) => lifecycleKinds.has(entry.kind))) {
    return null;
  }
  const actionMap = new Map(
    workflowActions.map((entry) => [entry.kind, entry.enabled]),
  );
  return {
    canPause: actionMap.get('pause_workflow') ?? false,
    canResume: actionMap.get('resume_workflow') ?? false,
    canCancel: actionMap.get('cancel_workflow') ?? false,
  };
}
