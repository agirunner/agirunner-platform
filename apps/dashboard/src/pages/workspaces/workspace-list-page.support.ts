import type { DashboardWorkspaceRecord } from '../../lib/api.js';

const WORKSPACE_DESCRIPTION_MAX_LENGTH = 116;
const WORKSPACE_DESCRIPTION_FALLBACK =
  'Add a short description so this workspace is scannable from the list.';

export interface WorkspaceListReadiness {
  label: 'Active' | 'Inactive';
  variant: 'success' | 'secondary';
}

export interface WorkspaceListSortState {
  key: 'recent_activity' | 'workspace_name' | 'workflow_volume';
  direction: 'asc' | 'desc';
}

export type WorkspaceListSortField = WorkspaceListSortState['key'];
export type WorkspaceListSortDirection = WorkspaceListSortState['direction'];

export function normalizeWorkspaces(
  response: { data: DashboardWorkspaceRecord[] } | DashboardWorkspaceRecord[],
): DashboardWorkspaceRecord[] {
  if (Array.isArray(response)) {
    return response;
  }

  return response?.data ?? [];
}

export function filterWorkspaces(
  workspaces: DashboardWorkspaceRecord[],
  showInactive: boolean,
): DashboardWorkspaceRecord[] {
  if (showInactive) {
    return workspaces;
  }

  return workspaces.filter((workspace) => workspace.is_active !== false);
}

export function sortWorkspaces(
  workspaces: DashboardWorkspaceRecord[],
  sort: WorkspaceListSortState,
): DashboardWorkspaceRecord[] {
  return [...workspaces].sort((left, right) => {
    const direction = sort.direction === 'asc' ? 1 : -1;

    if (sort.key === 'workspace_name') {
      return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }) * direction;
    }

    if (sort.key === 'workflow_volume') {
      const byVolume = (readTotalWorkflowCount(left) - readTotalWorkflowCount(right)) * direction;
      if (byVolume !== 0) {
        return byVolume;
      }
      return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }) * direction;
    }

    const byActivity = compareNullableNumber(
      readLastWorkflowActivity(left),
      readLastWorkflowActivity(right),
      direction,
    );
    if (byActivity !== 0) {
      return byActivity;
    }
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }) * direction;
  });
}

export function buildWorkspaceReadiness(
  workspace: DashboardWorkspaceRecord,
): WorkspaceListReadiness {
  if (workspace.is_active === false) {
    return {
      label: 'Inactive',
      variant: 'secondary',
    };
  }

  return {
    label: 'Active',
    variant: 'success',
  };
}

export function buildWorkspaceMetrics(
  workspace: DashboardWorkspaceRecord,
  sortKey: WorkspaceListSortField = 'recent_activity',
): string {
  const activeWorkflowCount = workspace.summary?.active_workflow_count ?? 0;
  const completedWorkflowCount = workspace.summary?.completed_workflow_count ?? 0;
  const totalWorkflowCount = readTotalWorkflowCount(workspace);
  const parts: string[] = [];

  if (sortKey === 'workflow_volume') {
    return totalWorkflowCount > 0
      ? `${totalWorkflowCount} workflow${totalWorkflowCount === 1 ? '' : 's'} total`
      : 'No workflows yet';
  }

  if (activeWorkflowCount > 0) {
    parts.push(`${activeWorkflowCount} active workflow${activeWorkflowCount === 1 ? '' : 's'}`);
  }

  if (completedWorkflowCount > 0) {
    parts.push(`${completedWorkflowCount} completed`);
  }

  if (parts.length === 0) {
    if (totalWorkflowCount > 0) {
      return `${totalWorkflowCount} workflow${totalWorkflowCount === 1 ? '' : 's'} total`;
    }
    return 'No workflows yet';
  }

  return parts.join(' · ');
}

export function buildWorkspaceSortDirectionLabel(
  field: WorkspaceListSortField,
  direction: WorkspaceListSortDirection,
): string {
  if (field === 'workspace_name') {
    return direction === 'asc' ? 'A → Z' : 'Z → A';
  }

  if (field === 'workflow_volume') {
    return direction === 'asc' ? 'Fewest workflows' : 'Most workflows';
  }

  return direction === 'asc' ? 'Oldest first' : 'Newest first';
}

export function buildWorkspaceDescription(
  workspace: DashboardWorkspaceRecord,
): string {
  const description = normalizeDescription(workspace.description);
  if (description.length === 0) {
    return WORKSPACE_DESCRIPTION_FALLBACK;
  }

  if (description.length <= WORKSPACE_DESCRIPTION_MAX_LENGTH) {
    return description;
  }

  return `${description.slice(0, WORKSPACE_DESCRIPTION_MAX_LENGTH - 1).trimEnd()}…`;
}

function normalizeDescription(description?: string | null): string {
  return description?.replace(/\s+/g, ' ').trim() ?? '';
}

function readTotalWorkflowCount(workspace: DashboardWorkspaceRecord): number {
  const summary = workspace.summary as
    | (typeof workspace.summary & {
        total_workflow_count?: number;
      })
    | undefined;
  return summary?.total_workflow_count
    ?? (workspace.summary?.active_workflow_count ?? 0) + (workspace.summary?.completed_workflow_count ?? 0);
}

function readLastWorkflowActivity(workspace: DashboardWorkspaceRecord): number | null {
  const summary = workspace.summary as
    | (typeof workspace.summary & {
        last_workflow_activity_at?: string | null;
      })
    | undefined;
  const value = summary?.last_workflow_activity_at;
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function compareNullableNumber(
  left: number | null,
  right: number | null,
  direction: 1 | -1,
): number {
  if (left === right) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  return (left - right) * direction;
}
