import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { NotFoundError, ValidationError } from '../errors/domain-errors.js';
import type { ArtifactStorageAdapter } from '../content/artifact-storage.js';
import { DEFAULT_ARTIFACT_CONTENT_TYPE } from '../content/storage-config.js';
import { ArtifactRetentionService } from './artifact-retention-service.js';
import { sanitizeSecretLikeRecord } from './secret-redaction.js';

interface ArtifactRow {
  id: string;
  tenant_id: string;
  workflow_id: string | null;
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

interface ArtifactPreviewDescriptor {
  isPreviewEligible: boolean;
  previewMode: 'text' | 'image' | 'pdf' | 'unsupported';
}

const ARTIFACT_METADATA_SECRET_REDACTION = 'redacted://artifact-metadata-secret';

export interface ArtifactResponse {
  id: string;
  workflow_id: string | null;
  project_id: string | null;
  task_id: string;
  logical_path: string;
  content_type: string;
  size_bytes: number;
  checksum_sha256: string;
  metadata: Record<string, unknown>;
  retention_policy: Record<string, unknown>;
  expires_at: string | null;
  created_at: string;
  download_url: string;
  preview_url: string | null;
  permalink_url: string | null;
  preview_eligible: boolean;
  preview_mode: ArtifactPreviewDescriptor['previewMode'];
  storage_backend: string;
}

export interface ArtifactPreviewResult {
  artifact: ArtifactResponse;
  contentType: string;
  data: Buffer;
  fileName: string;
}

interface TaskScopeRow {
  id: string;
  tenant_id: string;
  workflow_id: string | null;
  project_id: string | null;
  workflow_metadata: Record<string, unknown> | null;
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
    private readonly previewMaxBytes = 1024 * 1024,
  ) {
    this.retention = new ArtifactRetentionService(pool, storage);
  }

  async uploadTaskArtifact(identity: ApiKeyIdentity, taskId: string, input: ArtifactUploadInput) {
    await this.retention.purgeExpiredArtifacts(identity.tenantId);
    const task = await this.loadTask(identity.tenantId, taskId);
    const relativePath = sanitizeArtifactPath(input.path);
    const payload = decodeArtifactPayload(input.contentBase64);
    const artifactId = randomUUID();
    const scopeId = task.workflow_id ?? `task-${task.id}`;
    const logicalPath = `artifact:${scopeId}/${relativePath}`;
    const storageKey = buildStorageKey(identity.tenantId, scopeId, artifactId, relativePath);
    const stored = await this.storage.putObject(
      storageKey,
      payload,
      input.contentType ?? DEFAULT_ARTIFACT_CONTENT_TYPE,
    );
    const retention = resolveRetentionPolicy(task.workflow_metadata);

    const result = await this.pool.query<ArtifactRow>(
      `INSERT INTO workflow_artifacts
       (id, tenant_id, workflow_id, project_id, task_id, logical_path, storage_backend, storage_key, content_type,
        size_bytes, checksum_sha256, metadata, retention_policy, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14)
       RETURNING *`,
      [
        artifactId,
        identity.tenantId,
        task.workflow_id,
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
       FROM workflow_artifacts
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
      artifact: await this.toArtifactResponse(row),
      contentType: row.content_type || payload.contentType,
      data: payload.data,
    };
  }

  async previewTaskArtifact(
    tenantId: string,
    taskId: string,
    artifactId: string,
  ): Promise<ArtifactPreviewResult> {
    await this.retention.purgeExpiredArtifacts(tenantId);
    const row = await this.loadArtifact(tenantId, taskId, artifactId);
    assertArtifactPreviewEligible(row.content_type, Number(row.size_bytes), this.previewMaxBytes);
    const payload = await this.storage.getObject(row.storage_key);

    return {
      artifact: await this.toArtifactResponse(row),
      contentType: row.content_type || payload.contentType,
      data: payload.data,
      fileName: artifactFileName(row.logical_path, row.id),
    };
  }

  async deleteTaskArtifact(identity: ApiKeyIdentity, taskId: string, artifactId: string) {
    await this.retention.purgeExpiredArtifacts(identity.tenantId);
    const row = await this.loadArtifact(identity.tenantId, taskId, artifactId);
    await this.storage.deleteObject(row.storage_key);
    await this.pool.query('DELETE FROM workflow_artifacts WHERE tenant_id = $1 AND id = $2', [
      identity.tenantId,
      artifactId,
    ]);
  }

  private async loadTask(tenantId: string, taskId: string): Promise<TaskScopeRow> {
    const result = await this.pool.query<TaskScopeRow>(
      `SELECT tasks.id,
              tasks.tenant_id,
              tasks.workflow_id,
              tasks.project_id,
              workflows.metadata AS workflow_metadata
         FROM tasks
         LEFT JOIN workflows
           ON workflows.tenant_id = tasks.tenant_id
          AND workflows.id = tasks.workflow_id
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
      'SELECT * FROM workflow_artifacts WHERE tenant_id = $1 AND task_id = $2 AND id = $3',
      [tenantId, taskId, artifactId],
    );
    const artifact = result.rows[0];
    if (!artifact) {
      throw new NotFoundError('Artifact not found');
    }
    return artifact;
  }

  private async toArtifactResponse(row: ArtifactRow): Promise<ArtifactResponse> {
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
      logical_path: row.logical_path,
      content_type: row.content_type,
      size_bytes: Number(row.size_bytes),
      checksum_sha256: row.checksum_sha256,
      metadata: sanitizeArtifactMetadata(row.metadata ?? {}),
      retention_policy: row.retention_policy ?? {},
      expires_at: row.expires_at?.toISOString() ?? null,
      created_at: row.created_at.toISOString(),
      download_url: `/api/v1/tasks/${row.task_id}/artifacts/${row.id}`,
      preview_url: preview.isPreviewEligible
        ? `/api/v1/tasks/${row.task_id}/artifacts/${row.id}/preview`
        : null,
      permalink_url: preview.isPreviewEligible
        ? `/api/v1/tasks/${row.task_id}/artifacts/${row.id}/permalink`
        : null,
      preview_eligible: preview.isPreviewEligible,
      preview_mode: preview.previewMode,
      storage_backend: row.storage_backend,
    };
  }
}

export function describeArtifactPreview(
  contentType: string,
  sizeBytes: number,
  maxBytes: number,
): ArtifactPreviewDescriptor {
  if (sizeBytes > maxBytes) {
    return { isPreviewEligible: false, previewMode: 'unsupported' };
  }

  const normalized = normalizeContentType(contentType);
  if (
    normalized.startsWith('text/plain') ||
    normalized.startsWith('text/markdown') ||
    normalized.startsWith('text/csv') ||
    normalized.startsWith('application/json') ||
    normalized.startsWith('application/ld+json') ||
    normalized.startsWith('application/x-yaml') ||
    normalized.startsWith('application/yaml') ||
    normalized.startsWith('text/yaml')
  ) {
    return { isPreviewEligible: true, previewMode: 'text' };
  }
  if (normalized.startsWith('image/')) {
    return { isPreviewEligible: true, previewMode: 'image' };
  }
  if (normalized.startsWith('application/pdf')) {
    return { isPreviewEligible: true, previewMode: 'pdf' };
  }
  return { isPreviewEligible: false, previewMode: 'unsupported' };
}

export function assertArtifactPreviewEligible(
  contentType: string,
  sizeBytes: number,
  maxBytes: number,
): void {
  if (!describeArtifactPreview(contentType, sizeBytes, maxBytes).isPreviewEligible) {
    throw new ValidationError('Artifact is not eligible for inline preview');
  }
}

function normalizeContentType(contentType: string): string {
  return contentType.trim().toLowerCase().split(';', 1)[0] ?? '';
}

function artifactFileName(logicalPath: string, artifactId: string): string {
  const candidate = path.posix.basename(logicalPath);
  return candidate && candidate !== '/' ? candidate : artifactId;
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

function sanitizeArtifactMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return sanitizeSecretLikeRecord(metadata, {
    redactionValue: ARTIFACT_METADATA_SECRET_REDACTION,
  });
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
    policy: { mode: 'ephemeral', destroy_on_workflow_complete: true },
    expiresAt: null,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}
