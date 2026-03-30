import type { DashboardPlaybookRecord, DashboardWorkspaceRecord } from '../../lib/api.js';
import type { ComboboxItem } from '../../components/log-viewer/ui/searchable-combobox.js';
import type { LaunchParameterSpec } from './workflow-launch-support.js';

export interface WorkflowLaunchDialogValidationResult {
  fieldErrors: {
    playbook?: string;
    workspace?: string;
    workflowName?: string;
    parameters?: string;
  };
  parameterErrors: Record<string, string>;
  blockingIssues: string[];
  isValid: boolean;
}

export function buildWorkflowLaunchComboboxItems(
  records: Array<
    Pick<DashboardPlaybookRecord, 'id' | 'name' | 'slug'>
    | Pick<DashboardWorkspaceRecord, 'id' | 'name' | 'slug'>
  >,
): ComboboxItem[] {
  return records.map((record) => ({
    id: record.id,
    label: record.name,
    subtitle: record.slug,
  }));
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
  const parameterErrors: Record<string, string> = {};

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
  for (const spec of input.parameterSpecs) {
    if (!spec.required) {
      continue;
    }
    if ((input.parameterDrafts[spec.slug]?.trim().length ?? 0) > 0) {
      continue;
    }
    parameterErrors[spec.slug] = `Enter a value for ${spec.title}.`;
  }

  const blockingIssues = Object.values(fieldErrors).filter((value): value is string => Boolean(value));
  return {
    fieldErrors,
    parameterErrors,
    blockingIssues,
    isValid: blockingIssues.length === 0,
  };
}
