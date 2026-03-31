import { randomUUID } from 'node:crypto';

import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { ArtifactStorageAdapter } from '../content/artifact-storage.js';
import type { DatabasePool, DatabaseQueryable } from '../db/database.js';
import { NotFoundError, ValidationError } from '../errors/domain-errors.js';
import {
  buildWorkflowOperatorFileRecordId,
  buildWorkflowOperatorStorageKey,
  decodeWorkflowOperatorFilePayload,
  resolveWorkflowOperatorFileContentType,
  sanitizeWorkflowOperatorFileDescription,
  sanitizeWorkflowOperatorFileName,
  type WorkflowOperatorFileUploadInput,
} from './workflow-operator/workflow-operator-file-support.js';
import { resolveOperatorRecordActorId } from './operator-record-authorship.js';

interface WorkflowPacketRow {
  id: string;
  tenant_id: string;
  workflow_id: string;
  work_item_id: string | null;
  request_id: string | null;
  source_intervention_id: string | null;
  source_attempt_id: string | null;
  packet_kind: string;
  source: string;
  summary: string | null;
  structured_inputs: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_by_kind: string;
  created_by_type: string;
  created_by_id: string;
  created_at: Date;
  updated_at: Date;
}

interface WorkflowPacketFileRow {
  id: string;
  tenant_id: string;
  workflow_id: string;
  packet_id: string;
  file_name: string;
  description: string | null;
  storage_backend: string;
  storage_key: string;
  content_type: string;
  size_bytes: number;
  checksum_sha256: string;
  created_at: Date;
}

export interface WorkflowInputPacketRecord {
  id: string;
  workflow_id: string;
  work_item_id: string | null;
  request_id: string | null;
  source_intervention_id: string | null;
  source_attempt_id: string | null;
  packet_kind: string;
  source: string;
  summary: string | null;
  structured_inputs: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_by_kind: string;
  created_by_type: string;
  created_by_id: string;
  created_at: string;
  updated_at: string;
  files: WorkflowInputPacketFileRecord[];
}

export interface WorkflowInputPacketFileRecord {
  id: string;
  file_name: string;
  description: string | null;
  content_type: string;
  size_bytes: number;
  created_at: string;
  download_url: string;
}

export interface CreateWorkflowInputPacketInput {
  requestId?: string;
  packetKind: string;
  source?: string;
  summary?: string;
  structuredInputs?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  createdByKind?: string;
  sourceInterventionId?: string;
  sourceAttemptId?: string;
  workItemId?: string;
  files: WorkflowOperatorFileUploadInput[];
}

export class WorkflowInputPacketService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly storage: ArtifactStorageAdapter,
    private readonly maxUploadFiles: number,
    private readonly maxUploadBytes: number,
  ) {}

  async createWorkflowInputPacket(
    identity: ApiKeyIdentity,
    workflowId: string,
    input: CreateWorkflowInputPacketInput,
    db?: DatabaseQueryable,
  ): Promise<WorkflowInputPacketRecord> {
    const ownsTransaction = !db;
    const client = ownsTransaction ? await this.pool.connect() : null;
    const queryable = client ?? db ?? this.pool;
    const storedKeys: string[] = [];

    try {
      if (client) {
        await client.query('BEGIN');
      }

      this.assertUploadCount(input.files);
      await this.loadWorkflow(queryable, identity.tenantId, workflowId);
      if (input.workItemId) {
        await this.assertWorkItem(queryable, identity.tenantId, workflowId, input.workItemId);
      }

      const packetId = randomUUID();
      const packetResult = await queryable.query<WorkflowPacketRow>(
        `INSERT INTO workflow_input_packets
           (id, tenant_id, workflow_id, work_item_id, request_id, source_intervention_id, source_attempt_id, packet_kind, source, summary, structured_inputs, metadata, created_by_kind, created_by_type, created_by_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14,$15)
         RETURNING *`,
        [
          packetId,
          identity.tenantId,
          workflowId,
          input.workItemId ?? null,
          sanitizeOptionalText(input.requestId),
          sanitizeOptionalText(input.sourceInterventionId),
          sanitizeOptionalText(input.sourceAttemptId),
          input.packetKind.trim(),
          sanitizeOptionalText(input.source) ?? 'operator',
          sanitizeOptionalText(input.summary),
          sanitizeRecord(input.structuredInputs),
          sanitizeRecord(input.metadata),
          sanitizeOptionalText(input.createdByKind) ?? 'operator',
          identity.ownerType,
          resolveOperatorRecordActorId(identity),
        ],
      );
      const packetRow = packetResult.rows[0];
      const fileRows = await this.createFiles(identity, workflowId, packetRow.id, input.files, queryable, storedKeys);

      if (client) {
        await client.query('COMMIT');
      }

      return toWorkflowInputPacketRecord(packetRow, fileRows);
    } catch (error) {
      const cleanupError = await this.cleanupStoredKeys(storedKeys);
      if (client) {
        await client.query('ROLLBACK');
      }
      if (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Workflow input packet creation failed and cleanup was incomplete');
      }
      throw error;
    } finally {
      client?.release();
    }
  }

  async listWorkflowInputPackets(tenantId: string, workflowId: string): Promise<WorkflowInputPacketRecord[]> {
    await this.loadWorkflow(this.pool, tenantId, workflowId);
    const [packetResult, fileResult] = await Promise.all([
      this.pool.query<WorkflowPacketRow>(
        `SELECT *
           FROM workflow_input_packets
          WHERE tenant_id = $1
            AND workflow_id = $2
          ORDER BY created_at DESC`,
        [tenantId, workflowId],
      ),
      this.pool.query<WorkflowPacketFileRow>(
        `SELECT *
           FROM workflow_input_packet_files
          WHERE tenant_id = $1
            AND workflow_id = $2
          ORDER BY created_at ASC`,
        [tenantId, workflowId],
      ),
    ]);

    const filesByPacket = new Map<string, WorkflowPacketFileRow[]>();
    for (const row of fileResult.rows) {
      const existing = filesByPacket.get(row.packet_id) ?? [];
      existing.push(row);
      filesByPacket.set(row.packet_id, existing);
    }

    return packetResult.rows.map((row) => toWorkflowInputPacketRecord(row, filesByPacket.get(row.id) ?? []));
  }

  async downloadWorkflowInputPacketFile(
    tenantId: string,
    workflowId: string,
    packetId: string,
    fileId: string,
  ): Promise<{ file: WorkflowInputPacketFileRecord; contentType: string; data: Buffer }> {
    const result = await this.pool.query<WorkflowPacketFileRow>(
      `SELECT *
         FROM workflow_input_packet_files
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND packet_id = $3
          AND id = $4`,
      [tenantId, workflowId, packetId, fileId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundError('Workflow input packet file not found');
    }
    const payload = await this.storage.getObject(row.storage_key);
    return {
      file: toWorkflowInputPacketFileRecord(row),
      contentType: row.content_type || payload.contentType,
      data: payload.data,
    };
  }

  private async createFiles(
    identity: ApiKeyIdentity,
    workflowId: string,
    packetId: string,
    files: WorkflowOperatorFileUploadInput[],
    db: DatabaseQueryable,
    storedKeys: string[],
  ): Promise<WorkflowPacketFileRow[]> {
    const created: WorkflowPacketFileRow[] = [];
    for (const input of files) {
      const fileId = buildWorkflowOperatorFileRecordId();
      const fileName = sanitizeWorkflowOperatorFileName(input.fileName);
      const description = sanitizeWorkflowOperatorFileDescription(input.description);
      const contentType = resolveWorkflowOperatorFileContentType(input.contentType);
      const payload = decodeWorkflowOperatorFilePayload(input.contentBase64, this.maxUploadBytes);
      const storageKey = buildWorkflowOperatorStorageKey({
        tenantId: identity.tenantId,
        workflowId,
        ownerPath: 'input-packets',
        ownerId: packetId,
        fileId,
        fileName,
      });
      const stored = await this.storage.putObject(storageKey, payload, contentType);
      storedKeys.push(stored.storageKey);
      const result = await db.query<WorkflowPacketFileRow>(
        `INSERT INTO workflow_input_packet_files
           (id, tenant_id, workflow_id, packet_id, file_name, description, storage_backend, storage_key, content_type, size_bytes, checksum_sha256)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
          fileId,
          identity.tenantId,
          workflowId,
          packetId,
          fileName,
          description,
          stored.backend,
          stored.storageKey,
          stored.contentType,
          stored.sizeBytes,
          stored.checksumSha256,
        ],
      );
      created.push(result.rows[0]);
    }
    return created;
  }

  private async cleanupStoredKeys(storedKeys: string[]): Promise<Error | null> {
    if (storedKeys.length === 0) {
      return null;
    }

    const results = await Promise.allSettled(
      Array.from(new Set(storedKeys)).map(async (storageKey) => this.storage.deleteObject(storageKey)),
    );
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason);
    if (failures.length === 0) {
      return null;
    }
    return new AggregateError(failures, 'Failed to clean up workflow input packet files');
  }

  private assertUploadCount(files: WorkflowOperatorFileUploadInput[]) {
    if (files.length > this.maxUploadFiles) {
      throw new ValidationError(`Workflow input packet supports at most ${this.maxUploadFiles} files per request`);
    }
  }

  private async loadWorkflow(
    db: DatabaseQueryable,
    tenantId: string,
    workflowId: string,
  ): Promise<void> {
    const result = await db.query(
      `SELECT id, workspace_id
         FROM workflows
        WHERE tenant_id = $1
          AND id = $2`,
      [tenantId, workflowId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Workflow not found');
    }
  }

  private async assertWorkItem(
    db: DatabaseQueryable,
    tenantId: string,
    workflowId: string,
    workItemId: string,
  ): Promise<void> {
    const result = await db.query(
      `SELECT id
         FROM workflow_work_items
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND id = $3`,
      [tenantId, workflowId, workItemId],
    );
    if (!result.rowCount) {
      throw new ValidationError('Workflow input packet work item must belong to the selected workflow');
    }
  }
}

function toWorkflowInputPacketRecord(
  row: WorkflowPacketRow,
  fileRows: WorkflowPacketFileRow[],
): WorkflowInputPacketRecord {
  return {
    id: row.id,
    workflow_id: row.workflow_id,
    work_item_id: row.work_item_id,
    request_id: row.request_id,
    source_intervention_id: row.source_intervention_id,
    source_attempt_id: row.source_attempt_id,
    packet_kind: row.packet_kind,
    source: row.source,
    summary: row.summary,
    structured_inputs: sanitizeRecord(row.structured_inputs),
    metadata: sanitizeRecord(row.metadata),
    created_by_kind: row.created_by_kind,
    created_by_type: row.created_by_type,
    created_by_id: row.created_by_id,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    files: fileRows.map(toWorkflowInputPacketFileRecord),
  };
}

function toWorkflowInputPacketFileRecord(row: WorkflowPacketFileRow): WorkflowInputPacketFileRecord {
  return {
    id: row.id,
    file_name: row.file_name,
    description: row.description,
    content_type: row.content_type,
    size_bytes: Number(row.size_bytes),
    created_at: row.created_at.toISOString(),
    download_url: `/api/v1/workflows/${row.workflow_id}/input-packets/${row.packet_id}/files/${row.id}/content`,
  };
}

function sanitizeOptionalText(value?: string): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeRecord(value?: Record<string, unknown> | null): Record<string, unknown> {
  if (!value || Array.isArray(value)) {
    return {};
  }
  return value;
}
