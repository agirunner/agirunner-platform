const LAST_WORKFLOW_STORAGE_KEY = 'agirunner.workflows.lastSelectedWorkflowId';
const WORKFLOW_RAIL_HIDDEN_STORAGE_KEY = 'agirunner.workflows.railHidden';

export function readStoredWorkflowId(): string | null {
  return readOptionalStorageValue(LAST_WORKFLOW_STORAGE_KEY);
}

export function writeStoredWorkflowId(workflowId: string | null): void {
  writeOptionalStorageValue(LAST_WORKFLOW_STORAGE_KEY, workflowId);
}

export function readStoredWorkflowRailHidden(): boolean {
  return readOptionalStorageValue(WORKFLOW_RAIL_HIDDEN_STORAGE_KEY) === '1';
}

export function writeStoredWorkflowRailHidden(isHidden: boolean): void {
  writeOptionalStorageValue(WORKFLOW_RAIL_HIDDEN_STORAGE_KEY, isHidden ? '1' : null);
}

function readOptionalStorageValue(key: string): string | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }
  const value = localStorage.getItem(key);
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

function writeOptionalStorageValue(key: string, value: string | null): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  if (!value) {
    localStorage.removeItem(key);
    return;
  }
  localStorage.setItem(key, value);
}
