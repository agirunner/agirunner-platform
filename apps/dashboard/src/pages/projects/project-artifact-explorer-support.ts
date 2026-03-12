import {
  describeArtifactPreview,
  type ArtifactPreviewKind,
} from '../../components/artifact-preview-support.js';
import type { DashboardTaskArtifactRecord } from '../../lib/api.js';
import type {
  ProjectTaskOption,
  ProjectWorkflowOption,
  ProjectWorkItemOption,
} from './project-content-browser-support.js';

export type ProjectArtifactSort =
  | 'newest'
  | 'oldest'
  | 'largest'
  | 'smallest'
  | 'name';

export interface ProjectArtifactEntry {
  id: string;
  artifactId: string;
  taskId: string;
  taskTitle: string;
  taskState: string;
  workflowId: string | null;
  workflowName: string;
  workflowState: string | null;
  workItemId: string | null;
  workItemTitle: string | null;
  stageName: string | null;
  role: string | null;
  logicalPath: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  downloadUrl: string;
  metadata: Record<string, unknown>;
  previewKind: ArtifactPreviewKind;
  canPreview: boolean;
}

export interface ProjectArtifactFilters {
  query: string;
  workflowId: string;
  workItemId: string;
  taskId: string;
  stageName: string;
  contentType: string;
  createdFrom: string;
  createdTo: string;
  sort: ProjectArtifactSort;
}

export interface ProjectArtifactSummary {
  totalArtifacts: number;
  previewableArtifacts: number;
  totalBytes: number;
  workflowCount: number;
  workItemCount: number;
  taskCount: number;
}

interface BuildProjectArtifactEntriesInput {
  workflows: ProjectWorkflowOption[];
  tasks: ProjectTaskOption[];
  workItems: ProjectWorkItemOption[];
  artifactsByTask: Record<string, DashboardTaskArtifactRecord[] | undefined>;
}

export function buildProjectArtifactEntries(
  input: BuildProjectArtifactEntriesInput,
): ProjectArtifactEntry[] {
  const workflowMap = new Map(input.workflows.map((workflow) => [workflow.id, workflow]));
  const workItemMap = new Map(input.workItems.map((workItem) => [workItem.id, workItem]));
  const entries: ProjectArtifactEntry[] = [];

  for (const task of input.tasks) {
    const workflow = task.workflowId ? workflowMap.get(task.workflowId) : null;
    const workItem = task.workItemId ? workItemMap.get(task.workItemId) : null;
    const artifacts = input.artifactsByTask[task.id] ?? [];

    for (const artifact of artifacts) {
      const preview = describeArtifactPreview(artifact.content_type, artifact.logical_path);
      entries.push({
        id: `${task.id}:${artifact.id}`,
        artifactId: artifact.id,
        taskId: task.id,
        taskTitle: task.title,
        taskState: task.state,
        workflowId: task.workflowId,
        workflowName: workflow?.name ?? task.workflowId ?? 'Unscoped workflow',
        workflowState: workflow?.state ?? null,
        workItemId: task.workItemId,
        workItemTitle: workItem?.title ?? null,
        stageName: task.stageName ?? workItem?.stageName ?? null,
        role: task.role,
        logicalPath: artifact.logical_path,
        fileName: extractArtifactFileName(artifact.logical_path),
        contentType: artifact.content_type,
        sizeBytes: artifact.size_bytes,
        createdAt: artifact.created_at,
        downloadUrl: artifact.download_url,
        metadata: artifact.metadata ?? {},
        previewKind: preview.kind,
        canPreview: preview.canPreview,
      });
    }
  }

  return entries;
}

export function filterProjectArtifactEntries(
  entries: ProjectArtifactEntry[],
  filters: ProjectArtifactFilters,
): ProjectArtifactEntry[] {
  const normalizedQuery = filters.query.trim().toLowerCase();
  const filtered = entries.filter((entry) => {
    if (filters.workflowId && entry.workflowId !== filters.workflowId) {
      return false;
    }
    if (filters.workItemId && entry.workItemId !== filters.workItemId) {
      return false;
    }
    if (filters.taskId && entry.taskId !== filters.taskId) {
      return false;
    }
    if (filters.stageName && entry.stageName !== filters.stageName) {
      return false;
    }
    if (filters.contentType && entry.contentType !== filters.contentType) {
      return false;
    }
    if (!isWithinDateRange(entry.createdAt, filters.createdFrom, filters.createdTo)) {
      return false;
    }
    if (!normalizedQuery) {
      return true;
    }

    return buildArtifactSearchIndex(entry).includes(normalizedQuery);
  });

  return filtered.sort((left, right) => compareArtifacts(left, right, filters.sort));
}

export function summarizeProjectArtifactEntries(
  entries: ProjectArtifactEntry[],
): ProjectArtifactSummary {
  return {
    totalArtifacts: entries.length,
    previewableArtifacts: entries.filter((entry) => entry.canPreview).length,
    totalBytes: entries.reduce((total, entry) => total + entry.sizeBytes, 0),
    workflowCount: new Set(entries.map((entry) => entry.workflowId).filter(Boolean)).size,
    workItemCount: new Set(entries.map((entry) => entry.workItemId).filter(Boolean)).size,
    taskCount: new Set(entries.map((entry) => entry.taskId)).size,
  };
}

export function buildArtifactStageOptions(entries: ProjectArtifactEntry[]): string[] {
  return buildUniqueOptions(entries.map((entry) => entry.stageName));
}

export function buildArtifactContentTypeOptions(entries: ProjectArtifactEntry[]): string[] {
  return buildUniqueOptions(entries.map((entry) => entry.contentType));
}

export function formatArtifactFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function extractArtifactFileName(logicalPath: string): string {
  const trimmed = logicalPath.trim();
  if (!trimmed) {
    return 'artifact';
  }
  const segments = trimmed.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? trimmed;
}

function buildArtifactSearchIndex(entry: ProjectArtifactEntry): string {
  return [
    entry.fileName,
    entry.logicalPath,
    entry.contentType,
    entry.workflowName,
    entry.workflowState,
    entry.workItemTitle,
    entry.stageName,
    entry.taskTitle,
    entry.taskState,
    entry.role,
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ')
    .toLowerCase();
}

function compareArtifacts(
  left: ProjectArtifactEntry,
  right: ProjectArtifactEntry,
  sort: ProjectArtifactSort,
): number {
  if (sort === 'oldest') {
    return left.createdAt.localeCompare(right.createdAt);
  }
  if (sort === 'largest') {
    return right.sizeBytes - left.sizeBytes || right.createdAt.localeCompare(left.createdAt);
  }
  if (sort === 'smallest') {
    return left.sizeBytes - right.sizeBytes || right.createdAt.localeCompare(left.createdAt);
  }
  if (sort === 'name') {
    return left.fileName.localeCompare(right.fileName) || right.createdAt.localeCompare(left.createdAt);
  }
  return right.createdAt.localeCompare(left.createdAt);
}

function isWithinDateRange(
  createdAt: string,
  createdFrom: string,
  createdTo: string,
): boolean {
  const createdTimestamp = Date.parse(createdAt);
  if (Number.isNaN(createdTimestamp)) {
    return false;
  }
  if (createdFrom) {
    const fromTimestamp = Date.parse(`${createdFrom}T00:00:00.000Z`);
    if (!Number.isNaN(fromTimestamp) && createdTimestamp < fromTimestamp) {
      return false;
    }
  }
  if (createdTo) {
    const toTimestamp = Date.parse(`${createdTo}T23:59:59.999Z`);
    if (!Number.isNaN(toTimestamp) && createdTimestamp > toTimestamp) {
      return false;
    }
  }
  return true;
}

function buildUniqueOptions(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim())))]
    .sort((left, right) => left.localeCompare(right));
}
