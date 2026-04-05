import type { DatabaseQueryable } from '../../db/database.js';
import { ConflictError, NotFoundError } from '../../errors/domain-errors.js';
import {
  asOptionalString,
  buildWorkflowDocumentReference,
  documentLocation,
  mergeWorkflowDocumentUpdate,
  normalizeApiWorkflowDocumentInput,
  normalizeDocumentDefinition,
  readOutputDocumentMap,
  validateWorkspaceDocumentRegistry,
  workflowDocumentMetadata,
} from './document-reference-service-support.js';
import {
  findWorkflowDocument,
  loadWorkflowScope,
  loadWorkspaceDocuments,
  requireWorkflowDocument,
  resolveArtifactReference,
  resolveWorkflowApiArtifactReference,
} from './document-reference-service-store.js';
import type {
  CreateWorkflowDocumentInput,
  ResolvedDocumentReference,
  UpdateWorkflowDocumentInput,
  WorkflowDocumentRow,
} from './document-reference-service.types.js';

export type {
  CreateWorkflowDocumentInput,
  ResolvedDocumentReference,
  UpdateWorkflowDocumentInput,
} from './document-reference-service.types.js';
export { validateWorkspaceDocumentRegistry } from './document-reference-service-support.js';

export async function listWorkflowDocuments(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
): Promise<ResolvedDocumentReference[]> {
  const workflow = await loadWorkflowScope(db, tenantId, workflowId);
  const documents = new Map<string, ResolvedDocumentReference>();

  if (workflow.workspace_id) {
    const workspaceDocuments = await loadWorkspaceDocuments(
      db,
      tenantId,
      workflow.workspace_id,
      workflow.workspace_spec_version,
    );
    for (const document of workspaceDocuments) {
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

  const workspaceId = asOptionalString(task.workspace_id);
  if (!workspaceId) {
    return [];
  }

  return loadWorkspaceDocuments(db, tenantId, workspaceId, null);
}

export async function registerTaskOutputDocuments(
  db: DatabaseQueryable,
  tenantId: string,
  task: Record<string, unknown>,
  output: unknown,
): Promise<void> {
  await registerTaskDocuments(db, tenantId, task, readOutputDocumentMap(output));
}

export async function registerTaskDocuments(
  db: DatabaseQueryable,
  tenantId: string,
  task: Record<string, unknown>,
  documentsInput: Record<string, unknown> | null | undefined,
): Promise<void> {
  const workflowId = asOptionalString(task.workflow_id);
  if (!workflowId) {
    return;
  }

  const documents = documentsInput ?? {};
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
         tenant_id, workflow_id, workspace_id, task_id, logical_name, source, location,
         artifact_id, content_type, title, description, metadata
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
       ON CONFLICT (tenant_id, workflow_id, logical_name)
       DO UPDATE SET
         workspace_id = EXCLUDED.workspace_id,
         task_id = EXCLUDED.task_id,
         source = EXCLUDED.source,
         location = EXCLUDED.location,
         artifact_id = EXCLUDED.artifact_id,
         content_type = EXCLUDED.content_type,
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         metadata = EXCLUDED.metadata`,
      [
        tenantId,
        workflowId,
        asOptionalString(task.workspace_id),
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
       tenant_id, workflow_id, workspace_id, task_id, logical_name, source, location,
       artifact_id, content_type, title, description, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
     RETURNING id, logical_name, source, location, artifact_id, content_type,
               title, description, metadata, task_id, created_at`,
    [
      tenantId,
      workflowId,
      workflow.workspace_id,
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
