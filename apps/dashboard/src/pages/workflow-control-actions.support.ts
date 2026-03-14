interface WorkflowControlStateInput {
  state?: string | null;
}

export interface WorkflowControlAvailability {
  canPause: boolean;
  canResume: boolean;
  canCancel: boolean;
}

export function getWorkflowControlAvailability(
  input: WorkflowControlStateInput,
): WorkflowControlAvailability {
  const state = input.state?.trim().toLowerCase() ?? '';
  return {
    canPause: state === 'pending' || state === 'active',
    canResume: state === 'paused',
    canCancel: state === 'pending' || state === 'active' || state === 'paused',
  };
}
