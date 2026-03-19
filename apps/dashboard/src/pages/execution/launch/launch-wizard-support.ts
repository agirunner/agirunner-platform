export type WizardStep = 'playbook' | 'workspace' | 'parameters' | 'launch';

export const WIZARD_STEPS: WizardStep[] = ['playbook', 'workspace', 'parameters', 'launch'];

export interface WizardState {
  playbookId: string | null;
  workspaceId: string | null;
  workflowName: string;
  branchName: string;
  parameters: Record<string, unknown>;
  tokenBudget: number;
  costCapUsd: number;
  watchLive: boolean;
}

export function initialWizardState(): WizardState {
  return {
    playbookId: null,
    workspaceId: null,
    workflowName: '',
    branchName: '',
    parameters: {},
    tokenBudget: 100000,
    costCapUsd: 10,
    watchLive: true,
  };
}

const STEP_LABELS: Record<WizardStep, string> = {
  playbook: 'Playbook',
  workspace: 'Workspace',
  parameters: 'Parameters',
  launch: 'Launch',
};

export function getStepIndex(step: WizardStep): number {
  return WIZARD_STEPS.indexOf(step);
}

export function getStepLabel(step: WizardStep): string {
  return STEP_LABELS[step];
}

export function canAdvance(step: WizardStep, state: WizardState): boolean {
  switch (step) {
    case 'playbook':
      return state.playbookId !== null;
    case 'workspace':
      return state.workspaceId !== null;
    case 'parameters':
      return true;
    case 'launch':
      return false;
  }
}
