import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { NotFoundError, ValidationError } from '../errors/domain-errors.js';
import type { ArtifactStorageAdapter } from '../content/artifact-storage.js';
import { DEFAULT_ARTIFACT_CONTENT_TYPE } from '../content/storage-config.js';
import { ArtifactRetentionService } from './artifact-retention-service.js';

interface ArtifactRow {
  id: string;
  tenant_id: string;
  pipeline_id: string | null;
  project_id: string | null;
  task_id: string;
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
  tenant_id: string;
  pipeline_id: string | null;
  project_id: string | null;
  pipeline_metadata: Record<string, unknown> | null;
}

export interface ArtifactUploadInput {
  path: string;
  contentBase64: string;
  contentType?: string;
  metadata?: Record<string, unknown>;
}

export class ArtifactService {
  private readonly retention: ArtifactRetentionService;

  constructor(
    private readonly pool: DatabasePool,
    private readonly storage: ArtifactStorageAdapter,
    private readonly accessUrlTtlSeconds: number,
  ) {
    this.retention = new ArtifactRetentionService(pool, storage);
  }

  async uploadTaskArtifact(identity: ApiKeyIdentity, taskId: string, input: ArtifactUploadInput) {
    await this.retention.purgeExpiredArtifacts(identity.tenantId);
    const task = await this.loadTask(identity.tenantId, taskId);
    const relativePath = sanitizeArtifactPath(input.path);
    const payload = decodeArtifactPayload(input.contentBase64);
    const artifactId = randomUUID();
    const scopeId = task.pipeline_id ?? `task-${task.id}`;
    const logicalPath = `artifact:${scopeId}/${relativePath}`;
    const storageKey = buildStorageKey(identity.tenantId, scopeId, artifactId, relativePath);
    const stored = await this.storage.putObject(
      storageKey,
      payload,
      input.contentType ?? DEFAULT_ARTIFACT_CONTENT_TYPE,
    );
    const retention = resolveRetentionPolicy(task.pipeline_metadata);

    const result = await this.pool.query<ArtifactRow>(
      `INSERT INTO pipeline_artifacts
       (id, tenant_id, pipeline_id, project_id, task_id, logical_path, storage_backend, storage_key, content_type,
        size_bytes, checksum_sha256, metadata, retention_policy, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14)
       RETURNING *`,
      [
        artifactId,
        identity.tenantId,
        task.pipeline_id,
        task.project_id,
        task.id,
        logicalPath,
        stored.backend,
        stored.storageKey,
        stored.contentType,
        stored.sizeBytes,
        stored.checksumSha256,
        input.metadata ?? {},
        retention.policy,
        retention.expiresAt,
      ],
    );

    return this.toArtifactResponse(result.rows[0]);
  }

  async listTaskArtifacts(tenantId: string, taskId: string, prefix?: string) {
    await this.retention.purgeExpiredArtifacts(tenantId);
    await this.loadTask(tenantId, taskId);
    const rows = await this.pool.query<ArtifactRow>(
      `SELECT *
       FROM pipeline_artifacts
       WHERE tenant_id = $1
         AND task_id = $2
         AND ($3::text IS NULL OR logical_path LIKE $3 || '%')
       ORDER BY created_at ASC`,
      [tenantId, taskId, prefix ?? null],
    );
    return Promise.all(rows.rows.map((row) => this.toArtifactResponse(row)));
  }

  async downloadTaskArtifact(tenantId: string, taskId: string, artifactId: string) {
    await this.retention.purgeExpiredArtifacts(tenantId);
    const row = await this.loadArtifact(tenantId, taskId, artifactId);
    const payload = await this.storage.getObject(row.storage_key);
    return {
      artifact: this.toArtifactResponse(row),
      contentType: row.content_type || payload.contentType,
      data: payload.data,
    };
  }

  async deleteTaskArtifact(identity: ApiKeyIdentity, taskId: string, artifactId: string) {
    await this.retention.purgeExpiredArtifacts(identity.tenantId);
    const row = await this.loadArtifact(identity.tenantId, taskId, artifactId);
    await this.storage.deleteObject(row.storage_key);
    await this.pool.query('DELETE FROM pipeline_artifacts WHERE tenant_id = $1 AND id = $2', [
      identity.tenantId,
      artifactId,
    ]);
  }

  private async loadTask(tenantId: string, taskId: string): Promise<TaskScopeRow> {
    const result = await this.pool.query<TaskScopeRow>(
      `SELECT tasks.id,
              tasks.tenant_id,
              tasks.pipeline_id,
              tasks.project_id,
              pipelines.metadata AS pipeline_metadata
         FROM tasks
         LEFT JOIN pipelines
           ON pipelines.tenant_id = tasks.tenant_id
          AND pipelines.id = tasks.pipeline_id
        WHERE tasks.tenant_id = $1
          AND tasks.id = $2`,
      [tenantId, taskId],
    );
    const task = result.rows[0];
    if (!task) {
      throw new NotFoundError('Task not found');
    }
    return task;
  }

  private async loadArtifact(
    tenantId: string,
    taskId: string,
    artifactId: string,
  ): Promise<ArtifactRow> {
    const result = await this.pool.query<ArtifactRow>(
      'SELECT * FROM pipeline_artifacts WHERE tenant_id = $1 AND task_id = $2 AND id = $3',
      [tenantId, taskId, artifactId],
    );
    const artifact = result.rows[0];
    if (!artifact) {
      throw new NotFoundError('Artifact not found');
    }
    return artifact;
  }

  private async toArtifactResponse(row: ArtifactRow) {
    const access = await this.storage.createAccessUrl(row.storage_key, this.accessUrlTtlSeconds);
    return {
      id: row.id,
      pipeline_id: row.pipeline_id,
      project_id: row.project_id,
      task_id: row.task_id,
      logical_path: row.logical_path,
      content_type: row.content_type,
      size_bytes: Number(row.size_bytes),
      checksum_sha256: row.checksum_sha256,
      metadata: row.metadata ?? {},
      retention_policy: row.retention_policy ?? {},
      expires_at: row.expires_at?.toISOString() ?? null,
      created_at: row.created_at.toISOString(),
      download_url: `/api/v1/tasks/${row.task_id}/artifacts/${row.id}`,
      access_url: access.url,
      access_url_expires_at: access.expiresAt?.toISOString() ?? null,
      storage_backend: row.storage_backend,
    };
  }
}

function sanitizeArtifactPath(value: string): string {
  const normalized = path.posix.normalize(value.trim().replace(/^\/+/, ''));
  if (
    !normalized ||
    normalized === '.' ||
    normalized.startsWith('../') ||
    normalized.includes('/../')
  ) {
    throw new ValidationError('Artifact path must be a safe relative path');
  }
  return normalized;
}

function decodeArtifactPayload(contentBase64: string): Buffer {
  try {
    const payload = Buffer.from(contentBase64, 'base64');
    if (payload.byteLength === 0) {
      throw new ValidationError('Artifact payload must not be empty');
    }
    return payload;
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    throw new ValidationError('Artifact payload must be valid base64');
  }
}

function buildStorageKey(
  tenantId: string,
  scopeId: string,
  artifactId: string,
  relativePath: string,
): string {
  const fileName = path.posix.basename(relativePath);
  return `${tenantId}/${scopeId}/${artifactId}/${fileName}`;
}

function resolveRetentionPolicy(metadata: Record<string, unknown> | null) {
  const artifactRetention = asRecord(metadata?.artifact_retention);
  const days = typeof artifactRetention?.days === 'number' ? artifactRetention.days : null;
  const mode = typeof artifactRetention?.mode === 'string' ? artifactRetention.mode : 'ephemeral';
  if (mode === 'days' && days && days > 0) {
    return {
      policy: { mode: 'days', days },
      expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
    };
  }
  if (mode === 'forever') {
    return {
      policy: { mode: 'forever' },
      expiresAt: null,
    };
  }
  return {
    policy: { mode: 'ephemeral', destroy_on_pipeline_complete: true },
    expiresAt: null,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}
