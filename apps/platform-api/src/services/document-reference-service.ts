import type { DatabaseQueryable } from '../db/database.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/domain-errors.js';
import { sanitizeSecretLikeRecord } from './secret-redaction.js';

type DocumentSource = 'repository' | 'artifact' | 'external';

interface ProjectSpecEnvelope {
  project_id: string;
  version: number;
  spec: Record<string, unknown>;
}

interface ArtifactLookupRow {
  id: string;
  task_id: string;
  logical_path: string;
  content_type: string;
}

interface WorkflowDocumentRow {
  id: string;
  logical_name: string;
  source: DocumentSource;
  location: string;
  artifact_id: string | null;
  content_type: string | null;
  title: string | null;
  description: string | null;
  metadata: Record<string, unknown> | null;
  task_id: string | null;
  created_at: Date;
}

interface WorkflowScopeRow {
  project_id: string | null;
  project_spec_version: number | null;
}

interface ProjectSpecRow {
  spec: Record<string, unknown>;
}

export interface ResolvedDocumentReference {
  logical_name: string;
  scope: 'project' | 'workflow';
  source: DocumentSource;
  title?: string;
  description?: string;
  metadata: Record<string, unknown>;
  created_at?: string;
  task_id?: string;
  repository?: string;
  path?: string;
  url?: string;
  artifact?: {
    id: string;
    task_id: string;
    logical_path: string;
    content_type?: string;
    download_url: string;
  };
}

export interface CreateWorkflowDocumentInput {
  logical_name: string;
  source: DocumentSource;
  title?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  repository?: string;
  path?: string;
  url?: string;
  task_id?: string;
  artifact_id?: string;
  logical_path?: string;
}

export interface UpdateWorkflowDocumentInput {
  source?: DocumentSource;
  title?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown>;
  repository?: string | null;
  path?: string | null;
  url?: string | null;
  task_id?: string | null;
  artifact_id?: string | null;
  logical_path?: string | null;
}

interface NormalizedDocumentDefinition {
  source: DocumentSource;
  title?: string;
  description?: string;
  metadata: Record<string, unknown>;
  repository?: string;
  path?: string;
  url?: string;
  artifact_id?: string;
  logical_path?: string;
}

export function validateProjectDocumentRegistry(spec: Record<string, unknown>): void {
  const documents = readDocumentMap(spec);
  for (const [logicalName, value] of Object.entries(documents)) {
    if (!logicalName.trim()) {
      throw new ValidationError('Document logical names must be non-empty');
    }
    normalizeDocumentDefinition(logicalName, value, 'project_spec');
  }
}

export async function listWorkflowDocuments(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
): Promise<ResolvedDocumentReference[]> {
  const workflow = await loadWorkflowScope(db, tenantId, workflowId);
  const documents = new Map<string, ResolvedDocumentReference>();

  if (workflow.project_id) {
    const projectDocuments = await loadProjectDocuments(
      db,
      tenantId,
      workflow.project_id,
      workflow.project_spec_version,
    );
    for (const document of projectDocuments) {
      documents.set(document.logical_name, document);
    }
  }

  const workflowRows = await db.query<WorkflowDocumentRow>(
    `SELECT id, logical_name, source, location, artifact_id, content_type, title, description, metadata, task_id, created_at
       FROM workflow_documents
      WHERE tenant_id = $1
        AND workflow_id = $2
      ORDER BY created_at ASC`,
    [tenantId, workflowId],
  );

  for (const row of workflowRows.rows) {
    documents.set(
      row.logical_name,
      buildWorkflowDocumentReference(row),
    );
  }

  return [...documents.values()].sort((left, right) =>
    left.logical_name.localeCompare(right.logical_name),
  );
}

export async function listTaskDocuments(
  db: DatabaseQueryable,
  tenantId: string,
  task: Record<string, unknown>,
): Promise<ResolvedDocumentReference[]> {
  const workflowId = asOptionalString(task.workflow_id);
  if (workflowId) {
    return listWorkflowDocuments(db, tenantId, workflowId);
  }

  const projectId = asOptionalString(task.project_id);
  if (!projectId) {
    return [];
  }

  return loadProjectDocuments(db, tenantId, projectId, null);
}

export async function registerTaskOutputDocuments(
  db: DatabaseQueryable,
  tenantId: string,
  task: Record<string, unknown>,
  output: unknown,
): Promise<void> {
  const workflowId = asOptionalString(task.workflow_id);
  if (!workflowId) {
    return;
  }

  const documents = readOutputDocumentMap(output);
  if (Object.keys(documents).length === 0) {
    return;
  }

  await db.query(
    'DELETE FROM workflow_documents WHERE tenant_id = $1 AND task_id = $2',
    [tenantId, task.id],
  );

  for (const [logicalName, value] of Object.entries(documents)) {
    const normalized = normalizeDocumentDefinition(logicalName, value, 'task_output');
    const artifact = await resolveArtifactReference(db, tenantId, task, normalized);

    await db.query(
      `INSERT INTO workflow_documents (
         tenant_id, workflow_id, project_id, task_id, logical_name, source, location,
         artifact_id, content_type, title, description, metadata
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
      [
        tenantId,
        workflowId,
        asOptionalString(task.project_id),
        task.id,
        logicalName,
        normalized.source,
        documentLocation(normalized, artifact),
        artifact?.id ?? null,
        artifact?.content_type ?? null,
        normalized.title ?? null,
        normalized.description ?? null,
        normalized.metadata,
      ],
    );
  }
}

export async function createWorkflowDocument(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
  input: CreateWorkflowDocumentInput,
): Promise<ResolvedDocumentReference> {
  const workflow = await loadWorkflowScope(db, tenantId, workflowId);
  const existing = await findWorkflowDocument(db, tenantId, workflowId, input.logical_name);
  if (existing) {
    throw new ConflictError('Workflow document already exists');
  }

  const normalized = normalizeApiWorkflowDocumentInput(input.logical_name, input);
  const artifact = await resolveWorkflowApiArtifactReference(
    db,
    tenantId,
    workflowId,
    normalized,
  );
  const result = await db.query<WorkflowDocumentRow>(
    `INSERT INTO workflow_documents (
       tenant_id, workflow_id, project_id, task_id, logical_name, source, location,
       artifact_id, content_type, title, description, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
     RETURNING id, logical_name, source, location, artifact_id, content_type,
               title, description, metadata, task_id, created_at`,
    [
      tenantId,
      workflowId,
      workflow.project_id,
      normalized.task_id ?? null,
      input.logical_name,
      normalized.source,
      documentLocation(normalized, artifact),
      artifact?.id ?? null,
      artifact?.content_type ?? null,
      normalized.title ?? null,
      normalized.description ?? null,
      workflowDocumentMetadata(normalized),
    ],
  );
  return buildWorkflowDocumentReference(result.rows[0]);
}

export async function updateWorkflowDocument(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
  logicalName: string,
  input: UpdateWorkflowDocumentInput,
): Promise<ResolvedDocumentReference> {
  await loadWorkflowScope(db, tenantId, workflowId);
  const current = await requireWorkflowDocument(db, tenantId, workflowId, logicalName);
  const merged = mergeWorkflowDocumentUpdate(current, input);
  const normalized = normalizeApiWorkflowDocumentInput(logicalName, merged);
  const artifact = await resolveWorkflowApiArtifactReference(
    db,
    tenantId,
    workflowId,
    normalized,
  );
  const result = await db.query<WorkflowDocumentRow>(
    `UPDATE workflow_documents
        SET task_id = $4,
            source = $5,
            location = $6,
            artifact_id = $7,
            content_type = $8,
            title = $9,
            description = $10,
            metadata = $11::jsonb
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND logical_name = $3
      RETURNING id, logical_name, source, location, artifact_id, content_type,
                title, description, metadata, task_id, created_at`,
    [
      tenantId,
      workflowId,
      logicalName,
      normalized.task_id ?? null,
      normalized.source,
      documentLocation(normalized, artifact),
      artifact?.id ?? null,
      artifact?.content_type ?? null,
      normalized.title ?? null,
      normalized.description ?? null,
      workflowDocumentMetadata(normalized),
    ],
  );
  return buildWorkflowDocumentReference(result.rows[0]);
}

export async function deleteWorkflowDocument(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
  logicalName: string,
): Promise<void> {
  const result = await db.query(
    `DELETE FROM workflow_documents
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND logical_name = $3`,
    [tenantId, workflowId, logicalName],
  );
  if (!result.rowCount) {
    throw new NotFoundError('Workflow document not found');
  }
}

async function loadWorkflowScope(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
): Promise<WorkflowScopeRow> {
  const result = await db.query<WorkflowScopeRow>(
    `SELECT project_id, project_spec_version
       FROM workflows
      WHERE tenant_id = $1
        AND id = $2`,
    [tenantId, workflowId],
  );
  if (!result.rowCount) {
    throw new NotFoundError('Workflow not found');
  }
  return result.rows[0];
}

async function loadProjectDocuments(
  db: DatabaseQueryable,
  tenantId: string,
  projectId: string,
  version: number | null,
): Promise<ResolvedDocumentReference[]> {
  const specEnvelope = await loadProjectSpec(db, tenantId, projectId, version);
  const documents = readDocumentMap(specEnvelope.spec);

  return Object.entries(documents)
    .map(([logicalName, value]) => {
      const normalized = normalizeDocumentDefinition(logicalName, value, 'project_spec');
      return buildProjectDocumentReference(logicalName, normalized);
    })
    .sort((left, right) => left.logical_name.localeCompare(right.logical_name));
}

async function loadProjectSpec(
  db: DatabaseQueryable,
  tenantId: string,
  projectId: string,
  version: number | null,
): Promise<ProjectSpecEnvelope> {
  const targetVersion = await resolveSpecVersion(db, tenantId, projectId, version);
  if (targetVersion === 0) {
    return { project_id: projectId, version: 0, spec: {} };
  }

  const result = await db.query<ProjectSpecRow>(
    `SELECT spec
       FROM project_spec_versions
      WHERE tenant_id = $1
        AND project_id = $2
        AND version = $3`,
    [tenantId, projectId, targetVersion],
  );
  if (!result.rowCount) {
    throw new NotFoundError('Project spec version not found');
  }

  return {
    project_id: projectId,
    version: targetVersion,
    spec: asRecord(result.rows[0].spec),
  };
}

async function resolveSpecVersion(
  db: DatabaseQueryable,
  tenantId: string,
  projectId: string,
  version: number | null,
): Promise<number> {
  if (typeof version === 'number' && Number.isFinite(version)) {
    return version;
  }

  const projectResult = await db.query<{ current_spec_version: number }>(
    `SELECT current_spec_version
       FROM projects
      WHERE tenant_id = $1
        AND id = $2`,
    [tenantId, projectId],
  );
  if (!projectResult.rowCount) {
    throw new NotFoundError('Project not found');
  }
  return projectResult.rows[0].current_spec_version;
}

function buildProjectDocumentReference(
  logicalName: string,
  normalized: NormalizedDocumentDefinition,
): ResolvedDocumentReference {
  return {
    logical_name: logicalName,
    scope: 'project',
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

function buildWorkflowDocumentReference(
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

interface WorkflowApiDocumentDefinition extends NormalizedDocumentDefinition {
  task_id?: string;
}

function normalizeApiWorkflowDocumentInput(
  logicalName: string,
  input: CreateWorkflowDocumentInput | WorkflowDocumentApiShape,
): WorkflowApiDocumentDefinition {
  const normalized = normalizeDocumentDefinition(logicalName, input, 'workflow_api');
  return {
    ...normalized,
    task_id: asOptionalString(input.task_id),
  };
}

interface WorkflowDocumentApiShape {
  source: DocumentSource;
  title?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown>;
  repository?: string | null;
  path?: string | null;
  url?: string | null;
  task_id?: string | null;
  artifact_id?: string | null;
  logical_path?: string | null;
}

async function resolveWorkflowApiArtifactReference(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
  document: WorkflowApiDocumentDefinition,
): Promise<ArtifactLookupRow | null> {
  if (document.source !== 'artifact') {
    return null;
  }
  if (!document.task_id) {
    throw new ValidationError('Artifact-backed workflow documents must provide task_id');
  }

  const result = await db.query<ArtifactLookupRow>(
    `SELECT id, task_id, logical_path, content_type
       FROM workflow_artifacts
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND task_id = $3
        AND (
          ($4::uuid IS NOT NULL AND id = $4::uuid)
          OR ($5::text IS NOT NULL AND logical_path = $5)
        )
      ORDER BY created_at DESC
      LIMIT 1`,
    [
      tenantId,
      workflowId,
      document.task_id,
      document.artifact_id ?? null,
      document.logical_path ?? null,
    ],
  );
  if (!result.rowCount) {
    throw new ValidationError('Artifact-backed workflow documents must reference an existing workflow artifact');
  }
  return result.rows[0];
}

async function resolveArtifactReference(
  db: DatabaseQueryable,
  tenantId: string,
  task: Record<string, unknown>,
  document: NormalizedDocumentDefinition,
): Promise<ArtifactLookupRow | null> {
  if (document.source !== 'artifact') {
    return null;
  }

  const taskId = asOptionalString(task.id);
  const workflowId = asOptionalString(task.workflow_id);
  const artifactId = document.artifact_id;
  const logicalPath = document.logical_path;

  if (!taskId || !workflowId) {
    throw new ValidationError('Artifact-backed document registration requires a persisted workflow task');
  }

  const result = await db.query<ArtifactLookupRow>(
    `SELECT id, task_id, logical_path, content_type
       FROM workflow_artifacts
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND (
          ($3::uuid IS NOT NULL AND id = $3::uuid)
          OR ($4::text IS NOT NULL AND logical_path = $4)
        )
      ORDER BY created_at DESC
      LIMIT 1`,
    [tenantId, workflowId, artifactId ?? null, logicalPath ?? null],
  );

  if (!result.rowCount) {
    throw new ValidationError('Artifact-backed document references must point to an existing workflow artifact');
  }

  return result.rows[0];
}

function documentLocation(
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

function normalizeDocumentDefinition(
  logicalName: string,
  value: unknown,
  sourceContext: 'project_spec' | 'task_output' | 'workflow_api',
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
  if (sourceContext === 'project_spec' && artifactId) {
    throw new ValidationError(
      `Document '${logicalName}' in project specs must reference artifacts by logical_path`,
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

async function findWorkflowDocument(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
  logicalName: string,
): Promise<WorkflowDocumentRow | null> {
  const result = await db.query<WorkflowDocumentRow>(
    `SELECT id, logical_name, source, location, artifact_id, content_type, title, description, metadata, task_id, created_at
       FROM workflow_documents
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND logical_name = $3
      ORDER BY created_at DESC
      LIMIT 1`,
    [tenantId, workflowId, logicalName],
  );
  return result.rows[0] ?? null;
}

async function requireWorkflowDocument(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
  logicalName: string,
): Promise<WorkflowDocumentRow> {
  const document = await findWorkflowDocument(db, tenantId, workflowId, logicalName);
  if (!document) {
    throw new NotFoundError('Workflow document not found');
  }
  return document;
}

function mergeWorkflowDocumentUpdate(
  current: WorkflowDocumentRow,
  input: UpdateWorkflowDocumentInput,
): WorkflowDocumentApiShape {
  const source = input.source ?? current.source;
  const metadata = input.metadata ?? asRecord(current.metadata);
  const currentRepository = typeof metadata.repository === 'string'
    ? metadata.repository
    : readRepositoryMetadata(current);

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

function readRepositoryMetadata(current: WorkflowDocumentRow): string | undefined {
  const metadata = asRecord(current.metadata);
  return typeof metadata.repository === 'string' ? metadata.repository : undefined;
}

function workflowDocumentMetadata(
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

function readOutputDocumentMap(output: unknown): Record<string, unknown> {
  return asRecord(asRecord(output).documents);
}

function readDocumentMap(spec: Record<string, unknown>): Record<string, unknown> {
  return asRecord(spec.documents);
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(message);
  }
  return value as Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isDocumentSource(value: unknown): value is DocumentSource {
  return value === 'repository' || value === 'artifact' || value === 'external';
}
