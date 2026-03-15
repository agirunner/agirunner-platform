import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { ArtifactStorageAdapter } from '../content/artifact-storage.js';
import { DEFAULT_ARTIFACT_CONTENT_TYPE } from '../content/storage-config.js';
import type { DatabasePool } from '../db/database.js';
import { NotFoundError, ValidationError } from '../errors/domain-errors.js';

interface ProjectArtifactFileRow {
  id: string;
  tenant_id: string;
  project_id: string;
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

interface ProjectRow {
  id: string;
  tenant_id: string;
}

export interface ProjectArtifactFileUploadInput {
  key?: string;
  description?: string;
  fileName: string;
  contentBase64: string;
  contentType?: string;
}

export interface ProjectArtifactFileRecord {
  id: string;
  project_id: string;
  key: string;
  description: string | null;
  file_name: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
  download_url: string;
}

export class ProjectArtifactFileService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly storage: ArtifactStorageAdapter,
    private readonly maxUploadFiles: number,
    private readonly maxUploadBytes: number,
  ) {}

  async listProjectArtifactFiles(tenantId: string, projectId: string): Promise<ProjectArtifactFileRecord[]> {
    await this.loadProject(tenantId, projectId);
    const result = await this.pool.query<ProjectArtifactFileRow>(
      `SELECT *
         FROM project_artifact_files
        WHERE tenant_id = $1
          AND project_id = $2
        ORDER BY created_at DESC, key ASC`,
      [tenantId, projectId],
    );
    return result.rows.map((row) => this.toRecord(row));
  }

  async uploadProjectArtifactFile(
    identity: ApiKeyIdentity,
    projectId: string,
    input: ProjectArtifactFileUploadInput,
  ): Promise<ProjectArtifactFileRecord> {
    const [record] = await this.uploadProjectArtifactFiles(identity, projectId, [input]);
    if (!record) {
      throw new ValidationError('Project artifact upload did not produce a stored file');
    }
    return record;
  }

  async uploadProjectArtifactFiles(
    identity: ApiKeyIdentity,
    projectId: string,
    inputs: ProjectArtifactFileUploadInput[],
  ): Promise<ProjectArtifactFileRecord[]> {
    if (inputs.length === 0) {
      throw new ValidationError('Project artifact upload cannot be empty');
    }
    if (inputs.length > this.maxUploadFiles) {
      throw new ValidationError(`Project artifact upload supports at most ${this.maxUploadFiles} files per request`);
    }

    await this.loadProject(identity.tenantId, projectId);

    const created: ProjectArtifactFileRecord[] = [];
    for (const input of inputs) {
      const fileName = sanitizeFileName(input.fileName);
      const key = sanitizeArtifactKey(input.key ?? deriveProjectArtifactKey(fileName));
      const description = sanitizeDescription(input.description);
      const payload = decodeArtifactPayload(input.contentBase64, this.maxUploadBytes);
      const artifactId = randomUUID();
      const storageKey = buildProjectStorageKey(identity.tenantId, projectId, artifactId, fileName);
      const stored = await this.storage.putObject(
        storageKey,
        payload,
        input.contentType ?? DEFAULT_ARTIFACT_CONTENT_TYPE,
      );

      const result = await this.pool.query<ProjectArtifactFileRow>(
        `INSERT INTO project_artifact_files
           (id, tenant_id, project_id, key, description, file_name, storage_backend, storage_key, content_type, size_bytes, checksum_sha256)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
          artifactId,
          identity.tenantId,
          projectId,
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

  async downloadProjectArtifactFile(
    tenantId: string,
    projectId: string,
    fileId: string,
  ): Promise<{ file: ProjectArtifactFileRecord; contentType: string; data: Buffer }> {
    const row = await this.loadFile(tenantId, projectId, fileId);
    const payload = await this.storage.getObject(row.storage_key);
    return {
      file: this.toRecord(row),
      contentType: row.content_type || payload.contentType,
      data: payload.data,
    };
  }

  async deleteProjectArtifactFile(identity: ApiKeyIdentity, projectId: string, fileId: string): Promise<void> {
    const row = await this.loadFile(identity.tenantId, projectId, fileId);
    await this.storage.deleteObject(row.storage_key);
    await this.pool.query(
      `DELETE FROM project_artifact_files
        WHERE tenant_id = $1
          AND project_id = $2
          AND id = $3`,
      [identity.tenantId, projectId, fileId],
    );
  }

  private async loadProject(tenantId: string, projectId: string): Promise<ProjectRow> {
    const result = await this.pool.query<ProjectRow>(
      `SELECT id, tenant_id
         FROM projects
        WHERE tenant_id = $1
          AND id = $2`,
      [tenantId, projectId],
    );
    const project = result.rows[0];
    if (!project) {
      throw new NotFoundError('Project not found');
    }
    return project;
  }

  private async loadFile(tenantId: string, projectId: string, fileId: string): Promise<ProjectArtifactFileRow> {
    const result = await this.pool.query<ProjectArtifactFileRow>(
      `SELECT *
         FROM project_artifact_files
        WHERE tenant_id = $1
          AND project_id = $2
          AND id = $3`,
      [tenantId, projectId, fileId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundError('Project file not found');
    }
    return row;
  }

  private toRecord(row: ProjectArtifactFileRow): ProjectArtifactFileRecord {
    return {
      id: row.id,
      project_id: row.project_id,
      key: row.key,
      description: row.description,
      file_name: row.file_name,
      content_type: row.content_type,
      size_bytes: Number(row.size_bytes),
      created_at: row.created_at.toISOString(),
      download_url: `/api/v1/projects/${row.project_id}/files/${row.id}/content`,
    };
  }
}

function sanitizeFileName(value: string): string {
  const fileName = path.basename(value.trim());
  if (!fileName) {
    throw new ValidationError('Project file name is required');
  }
  if (fileName.length > 255) {
    throw new ValidationError('Project file name must be at most 255 characters');
  }
  return fileName;
}

function sanitizeArtifactKey(value: string): string {
  const key = value.trim();
  if (!key) {
    throw new ValidationError('Project artifact key is required');
  }
  if (key.length > 120) {
    throw new ValidationError('Project artifact key must be at most 120 characters');
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
    throw new ValidationError('Project artifact description must be at most 2000 characters');
  }
  return trimmed;
}

export function deriveProjectArtifactKey(fileName: string): string {
  const normalized = fileName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || `file-${randomUUID().slice(0, 8)}`;
}

function buildProjectStorageKey(
  tenantId: string,
  projectId: string,
  artifactId: string,
  fileName: string,
): string {
  return ['tenants', tenantId, 'projects', projectId, 'files', artifactId, fileName].join('/');
}

function decodeArtifactPayload(contentBase64: string, maxUploadBytes: number): Buffer {
  try {
    const payload = Buffer.from(contentBase64, 'base64');
    if (payload.length === 0) {
      throw new ValidationError('Project artifact payload cannot be empty');
    }
    if (payload.length > maxUploadBytes) {
      throw new ValidationError(`Project artifact file exceeds ${maxUploadBytes} bytes`);
    }
    return payload;
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    throw new ValidationError('Project artifact payload must be valid base64');
  }
}
