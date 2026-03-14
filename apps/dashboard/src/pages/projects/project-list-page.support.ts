import type { DashboardProjectRecord } from '../../lib/api.js';

const PROJECT_DESCRIPTION_MAX_LENGTH = 116;
const PROJECT_DESCRIPTION_FALLBACK =
  'Add a short description so this project is scannable from the list.';

export interface ProjectListReadiness {
  label: 'Active' | 'Inactive';
  variant: 'success' | 'secondary';
}

export interface ProjectListSortState {
  key: 'recent_activity' | 'project_name' | 'workflow_volume';
  direction: 'asc' | 'desc';
}

export type ProjectListSortField = ProjectListSortState['key'];
export type ProjectListSortDirection = ProjectListSortState['direction'];

export function normalizeProjects(
  response: { data: DashboardProjectRecord[] } | DashboardProjectRecord[],
): DashboardProjectRecord[] {
  if (Array.isArray(response)) {
    return response;
  }

  return response?.data ?? [];
}

export function filterProjects(
  projects: DashboardProjectRecord[],
  showInactive: boolean,
): DashboardProjectRecord[] {
  if (showInactive) {
    return projects;
  }

  return projects.filter((project) => project.is_active !== false);
}

export function sortProjects(
  projects: DashboardProjectRecord[],
  sort: ProjectListSortState,
): DashboardProjectRecord[] {
  return [...projects].sort((left, right) => {
    const direction = sort.direction === 'asc' ? 1 : -1;

    if (sort.key === 'project_name') {
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

export function buildProjectReadiness(
  project: DashboardProjectRecord,
): ProjectListReadiness {
  if (project.is_active === false) {
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

export function buildProjectMetrics(
  project: DashboardProjectRecord,
  sortKey: ProjectListSortField = 'recent_activity',
): string {
  const activeWorkflowCount = project.summary?.active_workflow_count ?? 0;
  const completedWorkflowCount = project.summary?.completed_workflow_count ?? 0;
  const totalWorkflowCount = readTotalWorkflowCount(project);
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

export function buildProjectSortDirectionLabel(
  field: ProjectListSortField,
  direction: ProjectListSortDirection,
): string {
  if (field === 'project_name') {
    return direction === 'asc' ? 'A → Z' : 'Z → A';
  }

  if (field === 'workflow_volume') {
    return direction === 'asc' ? 'Fewest workflows' : 'Most workflows';
  }

  return direction === 'asc' ? 'Oldest first' : 'Newest first';
}

export function buildProjectDescription(
  project: DashboardProjectRecord,
): string {
  const description = normalizeDescription(project.description);
  if (description.length === 0) {
    return PROJECT_DESCRIPTION_FALLBACK;
  }

  if (description.length <= PROJECT_DESCRIPTION_MAX_LENGTH) {
    return description;
  }

  return `${description.slice(0, PROJECT_DESCRIPTION_MAX_LENGTH - 1).trimEnd()}…`;
}

function normalizeDescription(description?: string | null): string {
  return description?.replace(/\s+/g, ' ').trim() ?? '';
}

function readTotalWorkflowCount(project: DashboardProjectRecord): number {
  const summary = project.summary as
    | (typeof project.summary & {
        total_workflow_count?: number;
      })
    | undefined;
  return summary?.total_workflow_count
    ?? (project.summary?.active_workflow_count ?? 0) + (project.summary?.completed_workflow_count ?? 0);
}

function readLastWorkflowActivity(project: DashboardProjectRecord): number | null {
  const summary = project.summary as
    | (typeof project.summary & {
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
