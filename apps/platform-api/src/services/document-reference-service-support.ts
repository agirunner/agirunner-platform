import { ValidationError } from '../errors/domain-errors.js';
import { sanitizeSecretLikeRecord } from './secret-redaction.js';
import type {
  ArtifactLookupRow,
  CreateWorkflowDocumentInput,
  DocumentSource,
  NormalizedDocumentDefinition,
  ResolvedDocumentReference,
  UpdateWorkflowDocumentInput,
  WorkflowApiDocumentDefinition,
  WorkflowDocumentApiShape,
  WorkflowDocumentRow,
} from './document-reference-service.types.js';

export function validateWorkspaceDocumentRegistry(spec: Record<string, unknown>): void {
  const documents = readDocumentMap(spec);
  for (const [logicalName, value] of Object.entries(documents)) {
    if (!logicalName.trim()) {
      throw new ValidationError('Document logical names must be non-empty');
    }
    normalizeDocumentDefinition(logicalName, value, 'workspace_spec');
  }
}

export function buildWorkspaceDocumentReference(
  logicalName: string,
  normalized: NormalizedDocumentDefinition,
): ResolvedDocumentReference {
  return {
    logical_name: logicalName,
    scope: 'workspace',
    source: normalized.source,
    ...(normalized.title ? { title: normalized.title } : {}),
    ...(normalized.description ? { description: normalized.description } : {}),
    metadata: sanitizeSecretLikeRecord(normalized.metadata, {
      redactionValue: 'redacted://document-secret',
      allowSecretReferences: false,
    }),
    ...(normalized.repository ? { repository: normalized.repository } : {}),
    ...(normalized.path ? { path: normalized.path } : {}),
    ...(normalized.url ? { url: normalized.url } : {}),
  };
}

export function buildWorkflowDocumentReference(
  row: WorkflowDocumentRow,
): ResolvedDocumentReference {
  const metadata = sanitizeSecretLikeRecord(row.metadata, {
    redactionValue: 'redacted://document-secret',
    allowSecretReferences: false,
  });
  const base: ResolvedDocumentReference = {
    logical_name: row.logical_name,
    scope: 'workflow',
    source: row.source,
    metadata,
    created_at: row.created_at.toISOString(),
    ...(row.title ? { title: row.title } : {}),
    ...(row.description ? { description: row.description } : {}),
    ...(row.task_id ? { task_id: row.task_id } : {}),
  };

  if (row.source === 'external') {
    return { ...base, url: row.location };
  }
  if (row.source === 'repository') {
    return {
      ...base,
      path: row.location,
      ...(typeof metadata.repository === 'string'
        ? { repository: metadata.repository as string }
        : {}),
    };
  }
  if (!row.artifact_id || !row.task_id) {
    throw new ValidationError(`Workflow document '${row.logical_name}' is missing artifact linkage`);
  }
  return {
    ...base,
    artifact: {
      id: row.artifact_id,
      task_id: row.task_id,
      logical_path: row.location,
      ...(row.content_type ? { content_type: row.content_type } : {}),
      download_url: `/api/v1/tasks/${row.task_id}/artifacts/${row.artifact_id}`,
    },
  };
}

export function normalizeApiWorkflowDocumentInput(
  logicalName: string,
  input: CreateWorkflowDocumentInput | WorkflowDocumentApiShape,
): WorkflowApiDocumentDefinition {
  const normalized = normalizeDocumentDefinition(logicalName, input, 'workflow_api');
  return {
    ...normalized,
    task_id: asOptionalString(input.task_id),
  };
}

export function documentLocation(
  document: NormalizedDocumentDefinition,
  artifact: ArtifactLookupRow | null,
): string {
  if (document.source === 'external') {
    return document.url as string;
  }
  if (document.source === 'repository') {
    return document.path as string;
  }
  if (!artifact) {
    throw new ValidationError('Artifact-backed document references require a resolved artifact');
  }
  return artifact.logical_path;
}

export function normalizeDocumentDefinition(
  logicalName: string,
  value: unknown,
  sourceContext: 'workspace_spec' | 'task_output' | 'workflow_api',
): NormalizedDocumentDefinition {
  const entry = requireRecord(value, `Document '${logicalName}' must be an object`);
  const source = entry.source;
  if (!isDocumentSource(source)) {
    throw new ValidationError(`Document '${logicalName}' has unsupported source`);
  }

  const metadata = asRecord(entry.metadata);
  const title = asOptionalString(entry.title);
  const description = asOptionalString(entry.description);

  if (source === 'external') {
    const url = asOptionalString(entry.url);
    if (!url || !/^https?:\/\//.test(url)) {
      throw new ValidationError(`Document '${logicalName}' must provide an http(s) url`);
    }
    return { source, title, description, metadata, url };
  }

  if (source === 'repository') {
    const path = asOptionalString(entry.path);
    if (!path) {
      throw new ValidationError(`Document '${logicalName}' must provide a repository path`);
    }
    return {
      source,
      title,
      description,
      metadata,
      path,
      repository: asOptionalString(entry.repository),
    };
  }

  const artifactId = asOptionalString(entry.artifact_id);
  const logicalPath = asOptionalString(entry.logical_path);
  if (!artifactId && !logicalPath) {
    throw new ValidationError(
      `Document '${logicalName}' must provide an artifact_id or logical_path for artifact sources`,
    );
  }
  if (sourceContext === 'workspace_spec' && artifactId) {
    throw new ValidationError(
      `Document '${logicalName}' in workspace specs must reference artifacts by logical_path`,
    );
  }

  return {
    source,
    title,
    description,
    metadata,
    artifact_id: artifactId,
    logical_path: logicalPath,
  };
}

export function mergeWorkflowDocumentUpdate(
  current: WorkflowDocumentRow,
  input: UpdateWorkflowDocumentInput,
): WorkflowDocumentApiShape {
  const source = input.source ?? current.source;
  const metadata = input.metadata ?? asRecord(current.metadata);
  const currentRepository =
    typeof metadata.repository === 'string' ? metadata.repository : readRepositoryMetadata(current);

  return {
    source,
    title: input.title === undefined ? current.title : input.title,
    description: input.description === undefined ? current.description : input.description,
    metadata,
    repository:
      source === 'repository'
        ? input.repository === undefined
          ? currentRepository
          : input.repository
        : undefined,
    path:
      source === 'repository'
        ? input.path === undefined
          ? current.location
          : input.path
        : undefined,
    url:
      source === 'external'
        ? input.url === undefined
          ? current.location
          : input.url
        : undefined,
    task_id:
      source === 'artifact'
        ? input.task_id === undefined
          ? current.task_id
          : input.task_id
        : undefined,
    artifact_id:
      source === 'artifact'
        ? input.artifact_id === undefined
          ? current.artifact_id
          : input.artifact_id
        : undefined,
    logical_path:
      source === 'artifact'
        ? input.logical_path === undefined
          ? current.location
          : input.logical_path
        : undefined,
  };
}

export function workflowDocumentMetadata(
  document: WorkflowApiDocumentDefinition,
): Record<string, unknown> {
  if (document.source !== 'repository' || !document.repository) {
    return document.metadata;
  }
  return {
    ...document.metadata,
    repository: document.repository,
  };
}

export function readOutputDocumentMap(output: unknown): Record<string, unknown> {
  return asRecord(asRecord(output).documents);
}

export function readDocumentMap(spec: Record<string, unknown>): Record<string, unknown> {
  return asRecord(spec.documents);
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(message);
  }
  return value as Record<string, unknown>;
}

function readRepositoryMetadata(current: WorkflowDocumentRow): string | undefined {
  const metadata = asRecord(current.metadata);
  return typeof metadata.repository === 'string' ? metadata.repository : undefined;
}

function isDocumentSource(value: unknown): value is DocumentSource {
  return value === 'repository' || value === 'artifact' || value === 'external';
}
