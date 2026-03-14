import type {
  DashboardProjectRecord,
  DashboardProjectTimelineEntry,
  DashboardResolvedDocumentReference,
  DashboardTaskArtifactRecord,
  DashboardWorkflowWorkItemRecord,
} from '../../lib/api.js';
import { normalizeTaskState as normalizeCanonicalTaskState } from '../../lib/task-state.js';

export interface ProjectWorkflowOption {
  id: string;
  name: string;
  state: string;
  createdAt?: string;
}

export interface ProjectScopeOption {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  repository_url?: string | null;
  is_active?: boolean;
  memory?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  git_webhook_provider?: string | null;
  git_webhook_secret_configured?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface ProjectTaskOption {
  id: string;
  workflowId: string | null;
  title: string;
  state: string;
  stageName: string | null;
  workItemId: string | null;
  activationId: string | null;
  role: string | null;
  isOrchestratorTask: boolean;
  createdAt?: string;
}

export interface ProjectWorkItemOption {
  id: string;
  workflowId: string | null;
  title: string;
  stageName: string;
  columnId: string;
  priority: string;
  completedAt?: string | null;
}

export interface DocumentInventorySummary {
  totalDocuments: number;
  repositoryDocuments: number;
  artifactDocuments: number;
  externalDocuments: number;
  describedDocuments: number;
  metadataBackedDocuments: number;
  latestCreatedAt: string | null;
}

export interface ArtifactInventorySummary {
  totalArtifacts: number;
  totalBytes: number;
  metadataBackedArtifacts: number;
  uniqueContentTypes: number;
  latestCreatedAt: string | null;
}

export interface ArtifactExecutionScopeSummary {
  headline: string;
  detail: string;
  nextAction: string;
}

export interface ArtifactUploadPosture {
  isReady: boolean;
  headline: string;
  detail: string;
  blockers: string[];
}

export function normalizeProjectList(
  response: { data: DashboardProjectRecord[] } | DashboardProjectRecord[] | undefined,
): ProjectScopeOption[] {
  if (!response) {
    return [];
  }
  const records = Array.isArray(response) ? response : response.data ?? [];
  return records
    .filter((project): project is DashboardProjectRecord => isRecord(project))
    .map((project) => {
      const id = readContentString(project.id, '');
      const slug = readContentString(project.slug, id || 'project');
      return {
        ...project,
        id,
        slug,
        name: readContentString(project.name, slug || id || 'Unnamed project'),
      };
    })
    .filter((project) => project.id.length > 0);
}

export function buildWorkflowOptions(
  timeline: DashboardProjectTimelineEntry[] | undefined,
): ProjectWorkflowOption[] {
  if (!timeline) {
    return [];
  }

  const seen = new Set<string>();
  const workflows: ProjectWorkflowOption[] = [];

  for (const entry of timeline) {
    if (!entry.workflow_id || seen.has(entry.workflow_id)) {
      continue;
    }

    seen.add(entry.workflow_id);
    workflows.push({
      id: entry.workflow_id,
      name: readContentString(entry.name, entry.workflow_id),
      state: normalizeWorkflowState(entry.state),
      createdAt: readOptionalTimestampString(entry.created_at),
    });
  }

  return workflows;
}

export function normalizeTaskOptions(response: unknown): ProjectTaskOption[] {
  const records = Array.isArray(response)
    ? response
    : ((response as { data?: unknown } | undefined)?.data ?? []);

  if (!Array.isArray(records)) {
    return [];
  }

  const tasks: ProjectTaskOption[] = [];
  for (const record of records) {
    const task = record as Record<string, unknown>;
    const id = typeof task.id === 'string' ? task.id : null;
    if (!id) {
      continue;
    }

    tasks.push({
      id,
      workflowId: typeof task.workflow_id === 'string' ? task.workflow_id : null,
      title:
        (typeof task.title === 'string' && task.title) ||
        (typeof task.name === 'string' && task.name) ||
        id,
      state: normalizeTaskState(typeof task.state === 'string' ? task.state : 'unknown'),
      stageName: typeof task.stage_name === 'string' ? task.stage_name : null,
      workItemId: typeof task.work_item_id === 'string' ? task.work_item_id : null,
      activationId: typeof task.activation_id === 'string' ? task.activation_id : null,
      role: typeof task.role === 'string' ? task.role : null,
      isOrchestratorTask: Boolean(task.is_orchestrator_task),
      createdAt: readOptionalTimestampString(task.created_at),
    });
  }

  return tasks;
}

export function normalizeWorkItemOptions(
  workItems: DashboardWorkflowWorkItemRecord[] | undefined,
): ProjectWorkItemOption[] {
  if (!Array.isArray(workItems)) {
    return [];
  }

  return workItems
    .filter((item) => typeof item.id === 'string')
    .map((item) => ({
      id: item.id,
      workflowId: item.workflow_id ?? null,
      title: readContentString(item.title, item.id),
      stageName: readContentString(item.stage_name, 'No stage'),
      columnId: readContentString(item.column_id, 'planned'),
      priority: readContentString(item.priority, 'normal'),
      completedAt: readOptionalTimestampString(item.completed_at) ?? null,
    }));
}

export function normalizeDocumentRecords(
  documents: DashboardResolvedDocumentReference[] | undefined,
): DashboardResolvedDocumentReference[] {
  if (!Array.isArray(documents)) {
    return [];
  }

  const normalized: DashboardResolvedDocumentReference[] = [];
  for (const document of documents) {
    const logicalName = readContentString(document.logical_name, '');
    if (!logicalName) {
      continue;
    }

    normalized.push({
      ...document,
      logical_name: logicalName,
      scope: document.scope === 'project' ? 'project' : 'workflow',
      source: normalizeDocumentSource(document.source),
      title: readOptionalContentString(document.title),
      description: readOptionalContentString(document.description),
      created_at: readOptionalTimestampString(document.created_at),
      task_id: readOptionalContentString(document.task_id),
      repository: readOptionalContentString(document.repository),
      path: readOptionalContentString(document.path),
      url: readOptionalContentString(document.url),
      metadata: normalizeMetadataRecord(document.metadata),
      artifact: normalizeDocumentArtifact(document.artifact),
    });
  }

  return normalized;
}

export function normalizeArtifactRecords(
  artifacts: DashboardTaskArtifactRecord[] | undefined,
): DashboardTaskArtifactRecord[] {
  if (!Array.isArray(artifacts)) {
    return [];
  }

  const normalized: DashboardTaskArtifactRecord[] = [];
  for (const artifact of artifacts) {
    const id = readContentString(artifact.id, '');
    const taskId = readContentString(artifact.task_id, '');
    const logicalPath = readContentString(artifact.logical_path, '');
    if (!id || !taskId || !logicalPath) {
      continue;
    }

    normalized.push({
      ...artifact,
      id,
      task_id: taskId,
      workflow_id: readOptionalContentString(artifact.workflow_id),
      project_id: readOptionalContentString(artifact.project_id),
      logical_path: logicalPath,
      content_type: readContentString(artifact.content_type, 'application/octet-stream'),
      size_bytes: normalizeArtifactSize(artifact.size_bytes),
      checksum_sha256: readContentString(artifact.checksum_sha256, 'unknown'),
      metadata: normalizeMetadataRecord(artifact.metadata),
      retention_policy: normalizeMetadataRecord(artifact.retention_policy),
      expires_at: readOptionalTimestampString(artifact.expires_at),
      created_at: readTimestampString(artifact.created_at),
      download_url: readContentString(artifact.download_url, '#'),
      access_url: readOptionalContentString(artifact.access_url),
      access_url_expires_at: readOptionalTimestampString(artifact.access_url_expires_at),
      storage_backend: readOptionalContentString(artifact.storage_backend),
    });
  }

  return normalized;
}

export function filterTasksByWorkItem(
  tasks: ProjectTaskOption[],
  workItemId: string,
): ProjectTaskOption[] {
  if (!workItemId) {
    return tasks;
  }
  return tasks.filter((task) => task.workItemId === workItemId);
}

export function summarizeDocumentInventory(
  documents: DashboardResolvedDocumentReference[] | undefined,
): DocumentInventorySummary {
  if (!Array.isArray(documents) || documents.length === 0) {
    return {
      totalDocuments: 0,
      repositoryDocuments: 0,
      artifactDocuments: 0,
      externalDocuments: 0,
      describedDocuments: 0,
      metadataBackedDocuments: 0,
      latestCreatedAt: null,
    };
  }

  let repositoryDocuments = 0;
  let artifactDocuments = 0;
  let externalDocuments = 0;
  let describedDocuments = 0;
  let metadataBackedDocuments = 0;
  let latestCreatedAt: string | null = null;
  let latestTimestamp = 0;

  for (const document of documents) {
    if (document.source === 'repository') {
      repositoryDocuments += 1;
    } else if (document.source === 'artifact') {
      artifactDocuments += 1;
    } else {
      externalDocuments += 1;
    }

    if ((document.description ?? '').trim().length > 0) {
      describedDocuments += 1;
    }

    if (Object.keys(document.metadata ?? {}).length > 0) {
      metadataBackedDocuments += 1;
    }

    const timestamp = Date.parse(document.created_at ?? '');
    if (!Number.isNaN(timestamp) && timestamp >= latestTimestamp) {
      latestTimestamp = timestamp;
      latestCreatedAt = document.created_at ?? null;
    }
  }

  return {
    totalDocuments: documents.length,
    repositoryDocuments,
    artifactDocuments,
    externalDocuments,
    describedDocuments,
    metadataBackedDocuments,
    latestCreatedAt,
  };
}

export function summarizeArtifactInventory(
  artifacts: DashboardTaskArtifactRecord[] | undefined,
): ArtifactInventorySummary {
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    return {
      totalArtifacts: 0,
      totalBytes: 0,
      metadataBackedArtifacts: 0,
      uniqueContentTypes: 0,
      latestCreatedAt: null,
    };
  }

  let totalBytes = 0;
  let metadataBackedArtifacts = 0;
  let latestCreatedAt: string | null = null;
  let latestTimestamp = 0;
  const contentTypes = new Set<string>();

  for (const artifact of artifacts) {
    totalBytes += artifact.size_bytes;
    if (Object.keys(artifact.metadata ?? {}).length > 0) {
      metadataBackedArtifacts += 1;
    }
    if (artifact.content_type.trim().length > 0) {
      contentTypes.add(artifact.content_type);
    }

    const timestamp = Date.parse(artifact.created_at ?? '');
    if (!Number.isNaN(timestamp) && timestamp >= latestTimestamp) {
      latestTimestamp = timestamp;
      latestCreatedAt = artifact.created_at;
    }
  }

  return {
    totalArtifacts: artifacts.length,
    totalBytes,
    metadataBackedArtifacts,
    uniqueContentTypes: contentTypes.size,
    latestCreatedAt,
  };
}

export function summarizeArtifactExecutionScope(input: {
  selectedWorkflow: ProjectWorkflowOption | null;
  selectedWorkItem: ProjectWorkItemOption | null;
  selectedTask: ProjectTaskOption | null;
  filteredTaskCount: number;
}): ArtifactExecutionScopeSummary {
  if (input.selectedTask) {
    return {
      headline: input.selectedTask.title,
      detail: `${input.selectedTask.stageName ?? 'No stage'} • ${input.selectedTask.role ?? 'Unassigned role'} • ${input.selectedTask.state}`,
      nextAction: 'Upload or review artifacts for the selected execution step.',
    };
  }
  if (input.selectedWorkItem) {
    return {
      headline: input.selectedWorkItem.title,
      detail: `${input.selectedWorkItem.stageName} • ${input.selectedWorkItem.priority} priority • ${input.filteredTaskCount} scoped tasks`,
      nextAction: 'Choose a task in this work item to unlock uploads and artifact review.',
    };
  }
  if (input.selectedWorkflow) {
    return {
      headline: input.selectedWorkflow.name,
      detail: `${input.selectedWorkflow.state} workflow • ${input.filteredTaskCount} visible tasks`,
      nextAction: 'Pick a work item or task to anchor artifact management to live board context.',
    };
  }
  return {
    headline: 'No execution scope selected',
    detail: 'Choose a workflow before artifact management becomes available.',
    nextAction: 'Start with workflow scope, then narrow to a work item and task.',
  };
}

export function summarizeArtifactUploadPosture(input: {
  selectedTask: ProjectTaskOption | null;
  fileName: string | null;
  logicalPath: string;
  metadataError: string | null | undefined;
}): ArtifactUploadPosture {
  const blockers: string[] = [];

  if (!input.selectedTask) {
    blockers.push('Select a task for the artifact upload target.');
  }
  if (!input.fileName) {
    blockers.push('Choose a source file to upload.');
  }
  if (input.logicalPath.trim().length === 0) {
    blockers.push('Add a logical artifact path.');
  }
  if (input.metadataError) {
    blockers.push(input.metadataError);
  }

  if (blockers.length > 0) {
    return {
      isReady: false,
      headline: 'Action required before upload',
      detail: 'Resolve the blockers below so the artifact packet is scoped, named, and valid before upload.',
      blockers,
    };
  }

  return {
    isReady: true,
    headline: 'Ready to upload',
    detail: input.selectedTask
      ? `Upload is scoped to ${input.selectedTask.title} and the artifact packet is complete.`
      : 'Upload is ready.',
    blockers: [],
  };
}

export function formatContentRelativeTimestamp(
  value: unknown,
  now = Date.now(),
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return 'No timestamp recorded';
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }

  const deltaMinutes = Math.max(0, Math.round((now - timestamp) / 60000));
  if (deltaMinutes < 1) {
    return 'just now';
  }
  if (deltaMinutes < 60) {
    return `${deltaMinutes}m ago`;
  }
  const deltaHours = Math.round(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `${deltaHours}h ago`;
  }
  const deltaDays = Math.round(deltaHours / 24);
  return `${deltaDays}d ago`;
}

export function formatContentFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizeWorkflowState(state: unknown): string {
  const normalized = readContentString(state, 'unknown').toLowerCase();
  if (normalized === 'running') {
    return 'active';
  }
  if (normalized === 'created') {
    return 'pending';
  }
  return normalized;
}

function normalizeTaskState(state: string | null | undefined): string {
  return normalizeCanonicalTaskState(state ?? 'unknown');
}

function normalizeDocumentSource(
  value: DashboardResolvedDocumentReference['source'] | undefined,
): DashboardResolvedDocumentReference['source'] {
  return value === 'artifact' || value === 'external' ? value : 'repository';
}

function normalizeDocumentArtifact(
  artifact: DashboardResolvedDocumentReference['artifact'] | undefined,
): DashboardResolvedDocumentReference['artifact'] {
  if (!artifact || !isRecord(artifact)) {
    return undefined;
  }

  const id = readContentString(artifact.id, '');
  const taskId = readContentString(artifact.task_id, '');
  const logicalPath = readContentString(artifact.logical_path, '');
  const downloadUrl = readContentString(artifact.download_url, '');
  if (!id || !taskId || !logicalPath || !downloadUrl) {
    return undefined;
  }

  return {
    id,
    task_id: taskId,
    logical_path: logicalPath,
    content_type: readOptionalContentString(artifact.content_type),
    download_url: downloadUrl,
  };
}

function normalizeMetadataRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function normalizeArtifactSize(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function readContentString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function readOptionalContentString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function readTimestampString(value: unknown): string {
  return readOptionalTimestampString(value) ?? '';
}

function readOptionalTimestampString(value: unknown): string | undefined {
  return readOptionalContentString(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
