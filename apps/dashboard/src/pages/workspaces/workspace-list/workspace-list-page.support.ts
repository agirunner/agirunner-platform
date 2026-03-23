import type { DashboardWorkspaceRecord } from '../../../lib/api.js';
import { readWorkspaceStorageLabel } from '../workspace-detail-support.js';

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
export type WorkspaceListStatusFilter = 'all' | 'active' | 'inactive';

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
  search: string,
  status: WorkspaceListStatusFilter,
): DashboardWorkspaceRecord[] {
  const normalizedSearch = search.trim().toLowerCase();
  return workspaces.filter((workspace) => {
    if (status === 'active' && workspace.is_active === false) {
      return false;
    }
    if (status === 'inactive' && workspace.is_active !== false) {
      return false;
    }
    if (!normalizedSearch) {
      return true;
    }
    return buildWorkspaceSearchText(workspace).includes(normalizedSearch);
  });
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
    parts.push(
      completedWorkflowCount === 1
        ? '1 workflow completed'
        : `${completedWorkflowCount} workflows completed`,
    );
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

function buildWorkspaceSearchText(workspace: DashboardWorkspaceRecord): string {
  return [
    workspace.name,
    workspace.slug,
    readWorkspaceStorageLabel(workspace),
  ]
    .join(' ')
    .toLowerCase();
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
