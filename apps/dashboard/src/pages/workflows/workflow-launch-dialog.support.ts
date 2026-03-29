import type { DashboardPlaybookRecord, DashboardWorkspaceRecord } from '../../lib/api.js';
import type { ComboboxItem } from '../../components/log-viewer/ui/searchable-combobox.js';
import type { LaunchParameterSpec } from '../playbook-launch/playbook-launch-support.js';

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

export function filterWorkflowLaunchComboboxItems(
  items: ComboboxItem[],
  query: string,
): ComboboxItem[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return items;
  }
  return items.filter(
    (item) =>
      item.label.toLowerCase().includes(normalizedQuery)
      || item.subtitle?.toLowerCase().includes(normalizedQuery),
  );
}

export function resolveWorkflowLaunchTypedSelectionId(
  items: ComboboxItem[],
  query: string,
): string | null {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return null;
  }
  const matches = items.filter(
    (item) =>
      item.label.toLowerCase() === normalizedQuery
      || item.subtitle?.toLowerCase() === normalizedQuery,
  );
  return matches.length === 1 ? matches[0].id : null;
}

export function resolveWorkflowLaunchSelectorLabel(
  items: ComboboxItem[],
  selectedId: string,
): string {
  return items.find((item) => item.id === selectedId)?.label ?? '';
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
