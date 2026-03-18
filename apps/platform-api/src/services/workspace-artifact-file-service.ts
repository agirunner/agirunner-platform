import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { ArtifactStorageAdapter } from '../content/artifact-storage.js';
import { DEFAULT_ARTIFACT_CONTENT_TYPE } from '../content/storage-config.js';
import type { DatabasePool } from '../db/database.js';
import { NotFoundError, ValidationError } from '../errors/domain-errors.js';

interface WorkspaceArtifactFileRow {
  id: string;
  tenant_id: string;
  workspace_id: string;
  key: string;
  description: string | null;
  file_name: string;
  storage_backend: string;
  storage_key: string;
  content_type: string;
  size_bytes: number;
  checksum_sha256: string;
  created_at: Date;
}

interface WorkspaceRow {
  id: string;
  tenant_id: string;
}

export interface WorkspaceArtifactFileUploadInput {
  key?: string;
  description?: string;
  fileName: string;
  contentBase64: string;
  contentType?: string;
}

export interface WorkspaceArtifactFileRecord {
  id: string;
  workspace_id: string;
  key: string;
  description: string | null;
  file_name: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
  download_url: string;
}

export class WorkspaceArtifactFileService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly storage: ArtifactStorageAdapter,
    private readonly maxUploadFiles: number,
    private readonly maxUploadBytes: number,
  ) {}

  async listWorkspaceArtifactFiles(tenantId: string, workspaceId: string): Promise<WorkspaceArtifactFileRecord[]> {
    await this.loadWorkspace(tenantId, workspaceId);
    const result = await this.pool.query<WorkspaceArtifactFileRow>(
      `SELECT *
         FROM workspace_artifact_files
        WHERE tenant_id = $1
          AND workspace_id = $2
        ORDER BY created_at DESC, key ASC`,
      [tenantId, workspaceId],
    );
    return result.rows.map((row) => this.toRecord(row));
  }

  async uploadWorkspaceArtifactFile(
    identity: ApiKeyIdentity,
    workspaceId: string,
    input: WorkspaceArtifactFileUploadInput,
  ): Promise<WorkspaceArtifactFileRecord> {
    const [record] = await this.uploadWorkspaceArtifactFiles(identity, workspaceId, [input]);
    if (!record) {
      throw new ValidationError('Workspace artifact upload did not produce a stored file');
    }
    return record;
  }

  async uploadWorkspaceArtifactFiles(
    identity: ApiKeyIdentity,
    workspaceId: string,
    inputs: WorkspaceArtifactFileUploadInput[],
  ): Promise<WorkspaceArtifactFileRecord[]> {
    if (inputs.length === 0) {
      throw new ValidationError('Workspace artifact upload cannot be empty');
    }
    if (inputs.length > this.maxUploadFiles) {
      throw new ValidationError(`Workspace artifact upload supports at most ${this.maxUploadFiles} files per request`);
    }

    await this.loadWorkspace(identity.tenantId, workspaceId);

    const created: WorkspaceArtifactFileRecord[] = [];
    for (const input of inputs) {
      const fileName = sanitizeFileName(input.fileName);
      const key = sanitizeArtifactKey(input.key ?? deriveWorkspaceArtifactKey(fileName));
      const description = sanitizeDescription(input.description);
      const payload = decodeArtifactPayload(input.contentBase64, this.maxUploadBytes);
      const artifactId = randomUUID();
      const storageKey = buildWorkspaceStorageKey(identity.tenantId, workspaceId, artifactId, fileName);
      const stored = await this.storage.putObject(
        storageKey,
        payload,
        input.contentType ?? DEFAULT_ARTIFACT_CONTENT_TYPE,
      );

      const result = await this.pool.query<WorkspaceArtifactFileRow>(
        `INSERT INTO workspace_artifact_files
           (id, tenant_id, workspace_id, key, description, file_name, storage_backend, storage_key, content_type, size_bytes, checksum_sha256)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
          artifactId,
          identity.tenantId,
          workspaceId,
          key,
          description,
          fileName,
          stored.backend,
          stored.storageKey,
          stored.contentType,
          stored.sizeBytes,
          stored.checksumSha256,
        ],
      );

      created.push(this.toRecord(result.rows[0]));
    }

    return created;
  }

  async downloadWorkspaceArtifactFile(
    tenantId: string,
    workspaceId: string,
    fileId: string,
  ): Promise<{ file: WorkspaceArtifactFileRecord; contentType: string; data: Buffer }> {
    const row = await this.loadFile(tenantId, workspaceId, fileId);
    const payload = await this.storage.getObject(row.storage_key);
    return {
      file: this.toRecord(row),
      contentType: row.content_type || payload.contentType,
      data: payload.data,
    };
  }

  async deleteWorkspaceArtifactFile(identity: ApiKeyIdentity, workspaceId: string, fileId: string): Promise<void> {
    const row = await this.loadFile(identity.tenantId, workspaceId, fileId);
    await this.storage.deleteObject(row.storage_key);
    await this.pool.query(
      `DELETE FROM workspace_artifact_files
        WHERE tenant_id = $1
          AND workspace_id = $2
          AND id = $3`,
      [identity.tenantId, workspaceId, fileId],
    );
  }

  private async loadWorkspace(tenantId: string, workspaceId: string): Promise<WorkspaceRow> {
    const result = await this.pool.query<WorkspaceRow>(
      `SELECT id, tenant_id
         FROM workspaces
        WHERE tenant_id = $1
          AND id = $2`,
      [tenantId, workspaceId],
    );
    const workspace = result.rows[0];
    if (!workspace) {
      throw new NotFoundError('Workspace not found');
    }
    return workspace;
  }

  private async loadFile(tenantId: string, workspaceId: string, fileId: string): Promise<WorkspaceArtifactFileRow> {
    const result = await this.pool.query<WorkspaceArtifactFileRow>(
      `SELECT *
         FROM workspace_artifact_files
        WHERE tenant_id = $1
          AND workspace_id = $2
          AND id = $3`,
      [tenantId, workspaceId, fileId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundError('Workspace file not found');
    }
    return row;
  }

  private toRecord(row: WorkspaceArtifactFileRow): WorkspaceArtifactFileRecord {
    return {
      id: row.id,
      workspace_id: row.workspace_id,
      key: row.key,
      description: row.description,
      file_name: row.file_name,
      content_type: row.content_type,
      size_bytes: Number(row.size_bytes),
      created_at: row.created_at.toISOString(),
      download_url: `/api/v1/workspaces/${row.workspace_id}/files/${row.id}/content`,
    };
  }
}

function sanitizeFileName(value: string): string {
  const fileName = path.basename(value.trim());
  if (!fileName) {
    throw new ValidationError('Workspace file name is required');
  }
  if (fileName.length > 255) {
    throw new ValidationError('Workspace file name must be at most 255 characters');
  }
  return fileName;
}

function sanitizeArtifactKey(value: string): string {
  const key = value.trim();
  if (!key) {
    throw new ValidationError('Workspace artifact key is required');
  }
  if (key.length > 120) {
    throw new ValidationError('Workspace artifact key must be at most 120 characters');
  }
  return key;
}

function sanitizeDescription(value: string | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > 2000) {
    throw new ValidationError('Workspace artifact description must be at most 2000 characters');
  }
  return trimmed;
}

export function deriveWorkspaceArtifactKey(fileName: string): string {
  const normalized = fileName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || `file-${randomUUID().slice(0, 8)}`;
}

function buildWorkspaceStorageKey(
  tenantId: string,
  workspaceId: string,
  artifactId: string,
  fileName: string,
): string {
  return ['tenants', tenantId, 'workspaces', workspaceId, 'files', artifactId, fileName].join('/');
}

function decodeArtifactPayload(contentBase64: string, maxUploadBytes: number): Buffer {
  try {
    const payload = Buffer.from(contentBase64, 'base64');
    if (payload.length === 0) {
      throw new ValidationError('Workspace artifact payload cannot be empty');
    }
    if (payload.length > maxUploadBytes) {
      throw new ValidationError(`Workspace artifact file exceeds ${maxUploadBytes} bytes`);
    }
    return payload;
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    throw new ValidationError('Workspace artifact payload must be valid base64');
  }
}
