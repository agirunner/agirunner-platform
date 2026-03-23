import type {
  DashboardResolvedDocumentReference,
  DashboardWorkflowDocumentCreateInput,
  DashboardWorkflowDocumentUpdateInput,
} from '../../lib/api.js';

export interface WorkflowDocumentDraft {
  logicalName: string;
  source: 'repository' | 'artifact' | 'external';
  title: string;
  description: string;
  repository: string;
  path: string;
  url: string;
  taskId: string;
  artifactId: string;
  logicalPath: string;
}

export type WorkflowDocumentField =
  | 'logicalName'
  | 'title'
  | 'description'
  | 'repository'
  | 'path'
  | 'url'
  | 'taskId'
  | 'artifactReference'
  | 'logicalPath'
  | 'metadata';

export interface WorkflowDocumentValidationResult {
  fieldErrors: Partial<Record<WorkflowDocumentField, string>>;
  issueCount: number;
  isValid: boolean;
  summary: string;
}

const LOGICAL_NAME_MAX_LENGTH = 255;
const TITLE_MAX_LENGTH = 4000;
const DESCRIPTION_MAX_LENGTH = 8000;
const REPOSITORY_MAX_LENGTH = 255;
const LOCATION_MAX_LENGTH = 4000;

export function createEmptyWorkflowDocumentDraft(): WorkflowDocumentDraft {
  return {
    logicalName: '',
    source: 'repository',
    title: '',
    description: '',
    repository: '',
    path: '',
    url: '',
    taskId: '',
    artifactId: '',
    logicalPath: '',
  };
}

export function createWorkflowDocumentDraft(
  document: DashboardResolvedDocumentReference,
): WorkflowDocumentDraft {
  return {
    logicalName: document.logical_name,
    source: document.source,
    title: document.title ?? '',
    description: document.description ?? '',
    repository: document.repository ?? '',
    path: document.path ?? '',
    url: document.url ?? '',
    taskId: document.task_id ?? '',
    artifactId: document.artifact?.id ?? '',
    logicalPath: document.artifact?.logical_path ?? '',
  };
}

export function validateWorkflowDocumentDraft(
  draft: WorkflowDocumentDraft,
  metadataError?: string | null,
): WorkflowDocumentValidationResult {
  const fieldErrors: Partial<Record<WorkflowDocumentField, string>> = {};

  if (!draft.logicalName.trim()) {
    fieldErrors.logicalName = 'Logical name is required.';
  } else if (draft.logicalName.trim().length > LOGICAL_NAME_MAX_LENGTH) {
    fieldErrors.logicalName = `Logical name must be ${LOGICAL_NAME_MAX_LENGTH} characters or fewer.`;
  }

  if (draft.title.trim().length > TITLE_MAX_LENGTH) {
    fieldErrors.title = `Title must be ${TITLE_MAX_LENGTH} characters or fewer.`;
  }

  if (draft.description.trim().length > DESCRIPTION_MAX_LENGTH) {
    fieldErrors.description = `Description must be ${DESCRIPTION_MAX_LENGTH} characters or fewer.`;
  }

  if (draft.source === 'repository') {
    if (draft.repository.trim().length > REPOSITORY_MAX_LENGTH) {
      fieldErrors.repository =
        `Repository must be ${REPOSITORY_MAX_LENGTH} characters or fewer.`;
    }

    if (!draft.path.trim()) {
      fieldErrors.path = 'Repository path is required.';
    } else if (draft.path.trim().length > LOCATION_MAX_LENGTH) {
      fieldErrors.path = `Repository path must be ${LOCATION_MAX_LENGTH} characters or fewer.`;
    }
  }

  if (draft.source === 'external') {
    const trimmedUrl = draft.url.trim();
    if (!trimmedUrl) {
      fieldErrors.url = 'External URL is required.';
    } else if (!isValidUrl(trimmedUrl)) {
      fieldErrors.url = 'External URL must be valid.';
    }
  }

  if (draft.source === 'artifact') {
    if (!draft.taskId.trim()) {
      fieldErrors.taskId = 'Artifact-backed documents must select a workflow task.';
    }

    if (!draft.artifactId.trim() && !draft.logicalPath.trim()) {
      fieldErrors.artifactReference =
        'Select an artifact or enter its logical path for artifact-backed documents.';
    }

    if (draft.logicalPath.trim().length > LOCATION_MAX_LENGTH) {
      fieldErrors.logicalPath =
        `Artifact logical path must be ${LOCATION_MAX_LENGTH} characters or fewer.`;
    }
  }

  if (metadataError) {
    fieldErrors.metadata = metadataError;
  }

  const issueCount = Object.keys(fieldErrors).length;
  return {
    fieldErrors,
    issueCount,
    isValid: issueCount === 0,
    summary:
      issueCount === 0
        ? 'Ready to save this workflow document.'
        : `${issueCount} field${issueCount === 1 ? '' : 's'} need attention before this reference can be saved.`,
  };
}

export function buildWorkflowDocumentCreatePayload(
  draft: WorkflowDocumentDraft,
  metadata: Record<string, unknown>,
): DashboardWorkflowDocumentCreateInput {
  const base = {
    logical_name: draft.logicalName.trim(),
    source: draft.source,
    title: normalizeUndefinedString(draft.title),
    description: normalizeUndefinedString(draft.description),
    metadata,
  };

  if (draft.source === 'repository') {
    return {
      ...base,
      repository: normalizeUndefinedString(draft.repository),
      path: normalizeUndefinedString(draft.path),
    };
  }

  if (draft.source === 'external') {
    return {
      ...base,
      url: normalizeUndefinedString(draft.url),
    };
  }

  return {
    ...base,
    task_id: normalizeUndefinedString(draft.taskId),
    artifact_id: normalizeUndefinedString(draft.artifactId),
    logical_path: normalizeUndefinedString(draft.logicalPath),
  };
}

export function buildWorkflowDocumentUpdatePayload(
  draft: WorkflowDocumentDraft,
  metadata: Record<string, unknown>,
): DashboardWorkflowDocumentUpdateInput {
  const base: DashboardWorkflowDocumentUpdateInput = {
    source: draft.source,
    title: normalizeNullableString(draft.title),
    description: normalizeNullableString(draft.description),
    metadata,
  };

  if (draft.source === 'repository') {
    return {
      ...base,
      repository: normalizeNullableString(draft.repository),
      path: normalizeNullableString(draft.path),
      url: null,
      task_id: null,
      artifact_id: null,
      logical_path: null,
    };
  }

  if (draft.source === 'external') {
    return {
      ...base,
      repository: null,
      path: null,
      url: normalizeNullableString(draft.url),
      task_id: null,
      artifact_id: null,
      logical_path: null,
    };
  }

  return {
    ...base,
    repository: null,
    path: null,
    url: null,
    task_id: normalizeNullableString(draft.taskId),
    artifact_id: normalizeNullableString(draft.artifactId),
    logical_path: normalizeNullableString(draft.logicalPath),
  };
}

function normalizeUndefinedString(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeNullableString(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isValidUrl(value: string): boolean {
  try {
    // URL parsing keeps validation aligned with the backend's url contract.
    new URL(value);
    return true;
  } catch {
    return false;
  }
}
