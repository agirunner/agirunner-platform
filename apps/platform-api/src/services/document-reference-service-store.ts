import type { DatabaseQueryable } from '../db/database.js';
import { NotFoundError, ValidationError } from '../errors/domain-errors.js';
import {
  asOptionalString,
  asRecord,
  buildWorkspaceDocumentReference,
  normalizeDocumentDefinition,
  readDocumentMap,
} from './document-reference-service-support.js';
import type {
  ArtifactLookupRow,
  ResolvedDocumentReference,
  WorkflowApiDocumentDefinition,
  WorkflowDocumentRow,
  WorkflowScopeRow,
  WorkspaceSpecEnvelope,
  WorkspaceSpecRow,
} from './document-reference-service.types.js';

export async function loadWorkflowScope(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
): Promise<WorkflowScopeRow> {
  const result = await db.query<WorkflowScopeRow>(
    `SELECT workspace_id, workspace_spec_version
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

export async function loadWorkspaceDocuments(
  db: DatabaseQueryable,
  tenantId: string,
  workspaceId: string,
  version: number | null,
): Promise<ResolvedDocumentReference[]> {
  const specEnvelope = await loadWorkspaceSpec(db, tenantId, workspaceId, version);
  const documents = readDocumentMap(specEnvelope.spec);

  return Object.entries(documents)
    .map(([logicalName, value]) => {
      const normalized = normalizeDocumentDefinition(logicalName, value, 'workspace_spec');
      return buildWorkspaceDocumentReference(logicalName, normalized);
    })
    .sort((left, right) => left.logical_name.localeCompare(right.logical_name));
}

export async function findWorkflowDocument(
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

export async function requireWorkflowDocument(
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

export async function resolveWorkflowApiArtifactReference(
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
    throw new ValidationError(
      'Artifact-backed workflow documents must reference an existing workflow artifact',
    );
  }
  return result.rows[0];
}

export async function resolveArtifactReference(
  db: DatabaseQueryable,
  tenantId: string,
  task: Record<string, unknown>,
  document: WorkflowApiDocumentDefinition,
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
    throw new ValidationError(
      'Artifact-backed document references must point to an existing workflow artifact',
    );
  }

  return result.rows[0];
}

async function loadWorkspaceSpec(
  db: DatabaseQueryable,
  tenantId: string,
  workspaceId: string,
  version: number | null,
): Promise<WorkspaceSpecEnvelope> {
  const targetVersion = await resolveSpecVersion(db, tenantId, workspaceId, version);
  if (targetVersion === 0) {
    return { workspace_id: workspaceId, version: 0, spec: {} };
  }

  const result = await db.query<WorkspaceSpecRow>(
    `SELECT spec
       FROM workspace_spec_versions
      WHERE tenant_id = $1
        AND workspace_id = $2
        AND version = $3`,
    [tenantId, workspaceId, targetVersion],
  );
  if (!result.rowCount) {
    throw new NotFoundError('Workspace spec version not found');
  }

  return {
    workspace_id: workspaceId,
    version: targetVersion,
    spec: asRecord(result.rows[0].spec),
  };
}

async function resolveSpecVersion(
  db: DatabaseQueryable,
  tenantId: string,
  workspaceId: string,
  version: number | null,
): Promise<number> {
  if (typeof version === 'number' && Number.isFinite(version)) {
    return version;
  }

  const workspaceResult = await db.query<{ current_spec_version: number }>(
    `SELECT current_spec_version
       FROM workspaces
      WHERE tenant_id = $1
        AND id = $2`,
    [tenantId, workspaceId],
  );
  if (!workspaceResult.rowCount) {
    throw new NotFoundError('Workspace not found');
  }
  return workspaceResult.rows[0].current_spec_version;
}
