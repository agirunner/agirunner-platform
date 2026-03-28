const LAST_WORKFLOW_STORAGE_KEY = 'agirunner.workflows.lastSelectedWorkflowId';
const WORKFLOW_RAIL_HIDDEN_STORAGE_KEY = 'agirunner.workflows.railHidden';
const WORKFLOW_RAIL_WIDTH_STORAGE_KEY = 'agirunner.workflows.railWidthPx';
const WORKFLOW_WORKBENCH_FRACTION_STORAGE_KEY = 'agirunner.workflows.workbenchFraction';

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

export function readStoredWorkflowRailWidth(): number | null {
  return readOptionalStorageNumber(WORKFLOW_RAIL_WIDTH_STORAGE_KEY);
}

export function writeStoredWorkflowRailWidth(widthPx: number | null): void {
  writeOptionalStorageValue(
    WORKFLOW_RAIL_WIDTH_STORAGE_KEY,
    typeof widthPx === 'number' && Number.isFinite(widthPx) ? String(widthPx) : null,
  );
}

export function readStoredWorkflowWorkbenchFraction(): number | null {
  return readOptionalStorageNumber(WORKFLOW_WORKBENCH_FRACTION_STORAGE_KEY);
}

export function writeStoredWorkflowWorkbenchFraction(fraction: number | null): void {
  writeOptionalStorageValue(
    WORKFLOW_WORKBENCH_FRACTION_STORAGE_KEY,
    typeof fraction === 'number' && Number.isFinite(fraction) ? String(fraction) : null,
  );
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

function readOptionalStorageNumber(key: string): number | null {
  const value = readOptionalStorageValue(key);
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
