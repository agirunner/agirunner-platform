interface WorkflowControlStateInput {
  state?: string | null;
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
  return {
    canPause: state === 'active',
    canResume: state === 'paused',
    canCancel: state === 'active' || state === 'paused',
  };
}

function readWorkflowActionAvailability(
  availableActions: WorkflowControlStateInput['availableActions'],
): WorkflowControlAvailability | null {
  if (!availableActions) {
    return null;
  }
  const actionMap = new Map(
    availableActions
      .filter((entry) => (entry.scope?.trim().toLowerCase() ?? 'workflow') === 'workflow')
      .map((entry) => [entry.kind, entry.enabled]),
  );
  return {
    canPause: actionMap.get('pause_workflow') ?? false,
    canResume: actionMap.get('resume_workflow') ?? false,
    canCancel: actionMap.get('cancel_workflow') ?? false,
  };
}
