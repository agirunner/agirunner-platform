import type { DatabasePool } from '../db/database.js';
import { NotFoundError, ValidationError } from '../errors/domain-errors.js';
import type { ArtifactStorageAdapter } from '../content/artifact-storage.js';
import { sanitizeSecretLikeRecord } from './secret-redaction.js';
import {
  type ArtifactResponse,
  assertArtifactPreviewEligible,
  describeArtifactPreview,
} from './artifact-service.js';

const ARTIFACT_METADATA_SECRET_REDACTION = 'redacted://artifact-metadata-secret';

interface ArtifactCatalogRow {
  id: string;
  workflow_id: string | null;
  project_id: string | null;
  task_id: string;
  work_item_id: string | null;
  logical_path: string;
  storage_backend: string;
  storage_key: string;
  content_type: string;
  size_bytes: number;
  checksum_sha256: string;
  metadata: Record<string, unknown> | null;
  retention_policy: Record<string, unknown> | null;
  expires_at: Date | null;
  created_at: Date;
}

interface TaskScopeRow {
  id: string;
  workflow_id: string | null;
  project_id: string | null;
}

export interface ArtifactCatalogPreviewResult {
  artifact: ArtifactResponse & { work_item_id: string | null };
  contentType: string;
  data: Buffer;
  fileName: string;
}

export interface ArtifactCatalogQuery {
  task_id?: string;
  work_item_id?: string;
  name_prefix?: string;
  limit?: number;
}

export class ArtifactCatalogService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly storage: ArtifactStorageAdapter,
    private readonly accessUrlTtlSeconds: number,
    private readonly previewMaxBytes = 1024 * 1024,
  ) {}

  async listArtifactsForTaskScope(
    tenantId: string,
    currentTaskId: string,
    query: ArtifactCatalogQuery,
  ) {
    const currentTask = await this.loadTaskScope(tenantId, currentTaskId);
    const values: unknown[] = [tenantId];
    const conditions = ['fa.tenant_id = $1'];

    if (currentTask.workflow_id) {
      values.push(currentTask.workflow_id);
      conditions.push(`fa.workflow_id = $${values.length}`);
    } else {
      values.push(currentTask.id);
      conditions.push(`fa.task_id = $${values.length}`);
    }

    if (query.task_id) {
      values.push(query.task_id);
      conditions.push(`fa.task_id = $${values.length}`);
    }
    if (query.work_item_id) {
      values.push(query.work_item_id);
      conditions.push(`source_task.work_item_id = $${values.length}`);
    }
    if (query.name_prefix) {
      values.push(`${query.name_prefix}%`);
      conditions.push(`fa.logical_path ILIKE $${values.length}`);
    }

    const limit = normalizeLimit(query.limit);
    values.push(limit);
    const result = await this.pool.query<ArtifactCatalogRow>(
      `SELECT fa.id,
              fa.workflow_id,
              fa.project_id,
              fa.task_id,
              source_task.work_item_id,
              fa.logical_path,
              fa.storage_backend,
              fa.storage_key,
              fa.content_type,
              fa.size_bytes,
              fa.checksum_sha256,
              fa.metadata,
              fa.retention_policy,
              fa.expires_at,
              fa.created_at
         FROM workflow_artifacts fa
         JOIN tasks source_task
           ON source_task.tenant_id = fa.tenant_id
          AND source_task.id = fa.task_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY fa.created_at DESC
        LIMIT $${values.length}`,
      values,
    );
    return Promise.all(result.rows.map((row) => this.toArtifactResponse(row)));
  }

  async downloadArtifactForTaskScope(tenantId: string, currentTaskId: string, artifactId: string) {
    const currentTask = await this.loadTaskScope(tenantId, currentTaskId);
    const result = await this.pool.query<ArtifactCatalogRow>(
      `SELECT fa.id,
              fa.workflow_id,
              fa.project_id,
              fa.task_id,
              source_task.work_item_id,
              fa.logical_path,
              fa.storage_backend,
              fa.storage_key,
              fa.content_type,
              fa.size_bytes,
              fa.checksum_sha256,
              fa.metadata,
              fa.retention_policy,
              fa.expires_at,
              fa.created_at
         FROM workflow_artifacts fa
         JOIN tasks source_task
           ON source_task.tenant_id = fa.tenant_id
          AND source_task.id = fa.task_id
        WHERE fa.tenant_id = $1
          AND fa.id = $2
          AND (
            ($3::uuid IS NOT NULL AND fa.workflow_id = $3::uuid)
            OR fa.task_id = $4::uuid
          )
        LIMIT 1`,
      [tenantId, artifactId, currentTask.workflow_id, currentTask.id],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Artifact not found');
    }
    const row = result.rows[0];
    const payload = await this.storage.getObject(row.storage_key);
    return {
      artifact: await this.toArtifactResponse(row),
      contentType: row.content_type || payload.contentType,
      data: payload.data,
    };
  }

  async previewArtifactForTaskScope(
    tenantId: string,
    currentTaskId: string,
    artifactId: string,
  ): Promise<ArtifactCatalogPreviewResult> {
    const currentTask = await this.loadTaskScope(tenantId, currentTaskId);
    const row = await this.loadCatalogArtifact(tenantId, currentTask, artifactId);
    assertArtifactPreviewEligible(row.content_type, Number(row.size_bytes), this.previewMaxBytes);
    const payload = await this.storage.getObject(row.storage_key);
    return {
      artifact: await this.toArtifactResponse(row),
      contentType: row.content_type || payload.contentType,
      data: payload.data,
      fileName: artifactFileName(row.logical_path, row.id),
    };
  }

  private async loadTaskScope(tenantId: string, taskId: string): Promise<TaskScopeRow> {
    const result = await this.pool.query<TaskScopeRow>(
      'SELECT id, workflow_id, project_id FROM tasks WHERE tenant_id = $1 AND id = $2',
      [tenantId, taskId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Task not found');
    }
    return result.rows[0];
  }

  private async loadCatalogArtifact(
    tenantId: string,
    currentTask: TaskScopeRow,
    artifactId: string,
  ): Promise<ArtifactCatalogRow> {
    const result = await this.pool.query<ArtifactCatalogRow>(
      `SELECT fa.id,
              fa.workflow_id,
              fa.project_id,
              fa.task_id,
              source_task.work_item_id,
              fa.logical_path,
              fa.storage_backend,
              fa.storage_key,
              fa.content_type,
              fa.size_bytes,
              fa.checksum_sha256,
              fa.metadata,
              fa.retention_policy,
              fa.expires_at,
              fa.created_at
         FROM workflow_artifacts fa
         JOIN tasks source_task
           ON source_task.tenant_id = fa.tenant_id
          AND source_task.id = fa.task_id
        WHERE fa.tenant_id = $1
          AND fa.id = $2
          AND (
            ($3::uuid IS NOT NULL AND fa.workflow_id = $3::uuid)
            OR fa.task_id = $4::uuid
          )
        LIMIT 1`,
      [tenantId, artifactId, currentTask.workflow_id, currentTask.id],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Artifact not found');
    }
    return result.rows[0];
  }

  private async toArtifactResponse(
    row: ArtifactCatalogRow,
  ): Promise<ArtifactResponse & { work_item_id: string | null }> {
    const preview = describeArtifactPreview(
      row.content_type,
      Number(row.size_bytes),
      this.previewMaxBytes,
    );
    return {
      id: row.id,
      workflow_id: row.workflow_id,
      project_id: row.project_id,
      task_id: row.task_id,
      work_item_id: row.work_item_id,
      logical_path: row.logical_path,
      content_type: row.content_type,
      size_bytes: Number(row.size_bytes),
      checksum_sha256: row.checksum_sha256,
      metadata: sanitizeArtifactMetadata(row.metadata ?? {}),
      retention_policy: row.retention_policy ?? {},
      expires_at: row.expires_at?.toISOString() ?? null,
      created_at: row.created_at.toISOString(),
      download_url: `/api/v1/tasks/${row.task_id}/artifact-catalog/${row.id}`,
      preview_url: preview.isPreviewEligible
        ? `/api/v1/tasks/${row.task_id}/artifact-catalog/${row.id}/preview`
        : null,
      permalink_url: preview.isPreviewEligible
        ? `/api/v1/tasks/${row.task_id}/artifact-catalog/${row.id}/permalink`
        : null,
      preview_eligible: preview.isPreviewEligible,
      preview_mode: preview.previewMode,
      storage_backend: row.storage_backend,
    };
  }
}

function artifactFileName(logicalPath: string, artifactId: string): string {
  const candidate = logicalPath.split('/').pop();
  return candidate && candidate.length > 0 ? candidate : artifactId;
}

function normalizeLimit(value?: number): number {
  const limit = value ?? 50;
  if (!Number.isFinite(limit) || limit <= 0 || limit > 200) {
    throw new ValidationError('Artifact catalog limit must be between 1 and 200');
  }
  return Math.floor(limit);
}

function sanitizeArtifactMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return sanitizeSecretLikeRecord(metadata, {
    redactionValue: ARTIFACT_METADATA_SECRET_REDACTION,
  });
}
