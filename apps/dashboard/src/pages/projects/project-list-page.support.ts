import type { DashboardProjectRecord } from '../../lib/api.js';

export interface ProjectListPacket {
  label: string;
  value: string;
  detail: string;
}

export function normalizeProjects(
  response: { data: DashboardProjectRecord[] } | DashboardProjectRecord[],
): DashboardProjectRecord[] {
  if (Array.isArray(response)) {
    return response;
  }
  return response?.data ?? [];
}

export function statusVariant(isActive?: boolean) {
  if (isActive === true) return 'success' as const;
  if (isActive === false) return 'secondary' as const;
  return 'outline' as const;
}

export function buildProjectListPackets(
  projects: DashboardProjectRecord[],
): ProjectListPacket[] {
  const activeCount = projects.filter((project) => project.is_active).length;
  const repositoryLinkedCount = projects.filter((project) => project.repository_url).length;
  const describedCount = projects.filter((project) => project.description?.trim()).length;

  return [
    {
      label: 'Workspace coverage',
      value: `${projects.length} projects`,
      detail:
        projects.length > 0
          ? `${activeCount} active workspaces currently accept new execution and board work.`
          : 'Create the first project to start onboarding repositories, memory, and workflow boards.',
    },
    {
      label: 'Repository posture',
      value: `${repositoryLinkedCount} linked`,
      detail:
        projects.length > 0
          ? `${Math.max(projects.length - repositoryLinkedCount, 0)} still need a repository connection for git-backed execution.`
          : 'Repository coverage appears after your first project is created.',
    },
    {
      label: 'Operator next step',
      value:
        projects.length === 0
          ? 'Create a project'
          : projects.length === describedCount
            ? 'Open an active project'
            : 'Fill missing project briefs',
      detail:
        projects.length === 0
          ? 'Add the workspace, then connect its repository and memory surfaces from the project detail page.'
          : describedCount === projects.length
            ? 'Use the list below to open the project that needs the next board, memory, or artifact review.'
            : 'Complete the missing descriptions so operators can scan project intent before they drill into a workspace.',
    },
  ];
}

export function formatProjectCreatedAt(value?: string | null): string {
  if (!value) {
    return 'Created date unavailable';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Created date unavailable';
  }

  return parsed.toLocaleDateString();
}
