import type { DashboardPlaybookRecord, DashboardWorkspaceRecord } from '../../lib/api.js';
import type { LaunchParameterSpec } from '../playbook-launch/playbook-launch-support.js';

export interface WorkflowLaunchDialogValidationResult {
  fieldErrors: {
    playbook?: string;
    workspace?: string;
    workflowName?: string;
    parameters?: string;
  };
  blockingIssues: string[];
  isValid: boolean;
}

export function resolveDefaultWorkflowLaunchWorkspaceId(
  workspaces: DashboardWorkspaceRecord[],
  currentWorkspaceId: string,
): string {
  const trimmedCurrent = currentWorkspaceId.trim();
  if (trimmedCurrent.length > 0 && workspaces.some((workspace) => workspace.id === trimmedCurrent)) {
    return trimmedCurrent;
  }
  if (workspaces.length === 1) {
    return workspaces[0].id;
  }
  return '';
}

export function validateWorkflowLaunchDialogDraft(input: {
  selectedPlaybook: DashboardPlaybookRecord | null;
  workspaceId: string;
  workflowName: string;
  parameterSpecs: LaunchParameterSpec[];
  parameterDrafts: Record<string, string>;
}): WorkflowLaunchDialogValidationResult {
  const fieldErrors: WorkflowLaunchDialogValidationResult['fieldErrors'] = {};

  if (!input.selectedPlaybook) {
    fieldErrors.playbook = 'Select a playbook before launching a workflow.';
  } else if (input.selectedPlaybook.is_active === false) {
    fieldErrors.playbook =
      'Inactive playbooks must be reactivated from the detail page before launch.';
  }

  if (!input.workspaceId.trim()) {
    fieldErrors.workspace = 'Select a workspace before launching a workflow.';
  }

  if (!input.workflowName.trim()) {
    fieldErrors.workflowName = 'Workflow name is required before launch.';
  }

  const missingRequired = input.parameterSpecs.find(
    (spec) => spec.required && (input.parameterDrafts[spec.slug]?.trim().length ?? 0) === 0,
  );
  if (missingRequired) {
    fieldErrors.parameters = `Enter a value for required launch input '${missingRequired.title}'.`;
  }

  const blockingIssues = Object.values(fieldErrors).filter((value): value is string => Boolean(value));
  return {
    fieldErrors,
    blockingIssues,
    isValid: blockingIssues.length === 0,
  };
}
