import { randomUUID } from 'node:crypto';

import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { ArtifactStorageAdapter } from '../content/artifact-storage.js';
import type { DatabasePool } from '../db/database.js';
import { NotFoundError, ValidationError } from '../errors/domain-errors.js';
import {
  buildWorkflowOperatorFileRecordId,
  buildWorkflowOperatorStorageKey,
  decodeWorkflowOperatorFilePayload,
  resolveWorkflowOperatorFileContentType,
  sanitizeWorkflowOperatorFileDescription,
  sanitizeWorkflowOperatorFileName,
  type WorkflowOperatorFileUploadInput,
} from './workflow-operator-file-support.js';
import { resolveOperatorRecordActorId } from './operator-record-authorship.js';

interface WorkflowInterventionRow {
  id: string;
  tenant_id: string;
  workflow_id: string;
  work_item_id: string | null;
  task_id: string | null;
  request_id: string | null;
  kind: string;
  origin: string;
  status: string;
  outcome: string;
  result_kind: string;
  snapshot_version: string | null;
  settings_revision: number | null;
  summary: string;
  message: string | null;
  note: string | null;
  structured_action: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_by_type: string;
  created_by_id: string;
  created_at: Date;
  updated_at: Date;
}

interface WorkflowInterventionFileRow {
  id: string;
  tenant_id: string;
  workflow_id: string;
  intervention_id: string;
  file_name: string;
  description: string | null;
  storage_backend: string;
  storage_key: string;
  content_type: string;
  size_bytes: number;
  checksum_sha256: string;
  created_at: Date;
}

export interface WorkflowInterventionRecord {
  id: string;
  workflow_id: string;
  work_item_id: string | null;
  task_id: string | null;
  request_id: string | null;
  kind: string;
  origin: string;
  status: string;
  outcome: string;
  result_kind: string;
  snapshot_version: string | null;
  settings_revision: number | null;
  summary: string;
  message: string | null;
  note: string | null;
  structured_action: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_by_type: string;
  created_by_id: string;
  created_at: string;
  updated_at: string;
  files: WorkflowInterventionFileRecord[];
}

export interface WorkflowInterventionFileRecord {
  id: string;
  file_name: string;
  description: string | null;
  content_type: string;
  size_bytes: number;
  created_at: string;
  download_url: string;
}

export interface RecordWorkflowInterventionInput {
  requestId?: string;
  kind: string;
  origin?: string;
  status?: string;
  outcome?: string;
  resultKind?: string;
  snapshotVersion?: string;
  settingsRevision?: number;
  summary: string;
  message?: string;
  note?: string;
  structuredAction?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  workItemId?: string;
  taskId?: string;
  files: WorkflowOperatorFileUploadInput[];
}

export class WorkflowInterventionService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly storage: ArtifactStorageAdapter,
    private readonly maxUploadFiles: number,
    private readonly maxUploadBytes: number,
  ) {}

  async recordIntervention(
    identity: ApiKeyIdentity,
    workflowId: string,
    input: RecordWorkflowInterventionInput,
  ): Promise<WorkflowInterventionRecord> {
    this.assertUploadCount(input.files);
    await this.assertWorkflow(identity.tenantId, workflowId);
    if (input.workItemId) {
      await this.assertWorkItem(identity.tenantId, workflowId, input.workItemId);
    }
    if (input.taskId) {
      await this.assertTask(identity.tenantId, workflowId, input.taskId);
    }

    const interventionId = randomUUID();
    const result = await this.pool.query<WorkflowInterventionRow>(
      `INSERT INTO workflow_interventions
         (id, tenant_id, workflow_id, work_item_id, task_id, request_id, kind, origin, status, outcome, result_kind, snapshot_version, settings_revision, summary, message, note, structured_action, metadata, created_by_type, created_by_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18::jsonb,$19,$20)
       RETURNING *`,
      [
        interventionId,
        identity.tenantId,
        workflowId,
        input.workItemId ?? null,
        input.taskId ?? null,
        sanitizeOptionalText(input.requestId),
        input.kind.trim(),
        sanitizeOptionalText(input.origin) ?? 'operator',
        sanitizeOptionalText(input.status) ?? 'applied',
        sanitizeOptionalText(input.outcome) ?? 'applied',
        sanitizeOptionalText(input.resultKind) ?? 'intervention_recorded',
        sanitizeOptionalText(input.snapshotVersion),
        Number.isInteger(input.settingsRevision) ? input.settingsRevision : null,
        sanitizeRequiredText(input.summary, 'Workflow intervention summary is required'),
        sanitizeOptionalText(input.message),
        sanitizeOptionalText(input.note),
        sanitizeRecord(input.structuredAction),
        sanitizeRecord(input.metadata),
        identity.ownerType,
        resolveOperatorRecordActorId(identity),
      ],
    );
    const row = result.rows[0];
    const files = await this.createFiles(identity, workflowId, interventionId, input.files);
    return toWorkflowInterventionRecord(row, files);
  }

  async listWorkflowInterventions(tenantId: string, workflowId: string): Promise<WorkflowInterventionRecord[]> {
    await this.assertWorkflow(tenantId, workflowId);
    const [result, fileResult] = await Promise.all([
      this.pool.query<WorkflowInterventionRow>(
        `SELECT *
           FROM workflow_interventions
          WHERE tenant_id = $1
            AND workflow_id = $2
          ORDER BY created_at DESC`,
        [tenantId, workflowId],
      ),
      this.pool.query<WorkflowInterventionFileRow>(
        `SELECT *
           FROM workflow_intervention_files
          WHERE tenant_id = $1
            AND workflow_id = $2
          ORDER BY created_at ASC`,
        [tenantId, workflowId],
      ),
    ]);
    const filesByIntervention = new Map<string, WorkflowInterventionFileRow[]>();
    for (const row of fileResult.rows) {
      const existing = filesByIntervention.get(row.intervention_id) ?? [];
      existing.push(row);
      filesByIntervention.set(row.intervention_id, existing);
    }
    return result.rows.map((row) => toWorkflowInterventionRecord(row, filesByIntervention.get(row.id) ?? []));
  }

  async downloadWorkflowInterventionFile(
    tenantId: string,
    workflowId: string,
    interventionId: string,
    fileId: string,
  ): Promise<{ file: WorkflowInterventionFileRecord; contentType: string; data: Buffer }> {
    const result = await this.pool.query<WorkflowInterventionFileRow>(
      `SELECT *
         FROM workflow_intervention_files
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND intervention_id = $3
          AND id = $4`,
      [tenantId, workflowId, interventionId, fileId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundError('Workflow intervention file not found');
    }
    const payload = await this.storage.getObject(row.storage_key);
    return {
      file: toWorkflowInterventionFileRecord(row),
      contentType: row.content_type || payload.contentType,
      data: payload.data,
    };
  }

  private async createFiles(
    identity: ApiKeyIdentity,
    workflowId: string,
    interventionId: string,
    files: WorkflowOperatorFileUploadInput[],
  ): Promise<WorkflowInterventionFileRow[]> {
    const created: WorkflowInterventionFileRow[] = [];
    for (const input of files) {
      const fileId = buildWorkflowOperatorFileRecordId();
      const fileName = sanitizeWorkflowOperatorFileName(input.fileName);
      const description = sanitizeWorkflowOperatorFileDescription(input.description);
      const contentType = resolveWorkflowOperatorFileContentType(input.contentType);
      const payload = decodeWorkflowOperatorFilePayload(input.contentBase64, this.maxUploadBytes);
      const storageKey = buildWorkflowOperatorStorageKey({
        tenantId: identity.tenantId,
        workflowId,
        ownerPath: 'interventions',
        ownerId: interventionId,
        fileId,
        fileName,
      });
      const stored = await this.storage.putObject(storageKey, payload, contentType);
      const result = await this.pool.query<WorkflowInterventionFileRow>(
        `INSERT INTO workflow_intervention_files
           (id, tenant_id, workflow_id, intervention_id, file_name, description, storage_backend, storage_key, content_type, size_bytes, checksum_sha256)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
          fileId,
          identity.tenantId,
          workflowId,
          interventionId,
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

  private assertUploadCount(files: WorkflowOperatorFileUploadInput[]) {
    if (files.length > this.maxUploadFiles) {
      throw new ValidationError(`Workflow intervention supports at most ${this.maxUploadFiles} files per request`);
    }
  }

  private async assertWorkflow(tenantId: string, workflowId: string): Promise<void> {
    const result = await this.pool.query(
      `SELECT id
         FROM workflows
        WHERE tenant_id = $1
          AND id = $2`,
      [tenantId, workflowId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Workflow not found');
    }
  }

  private async assertWorkItem(tenantId: string, workflowId: string, workItemId: string): Promise<void> {
    const result = await this.pool.query(
      `SELECT id
         FROM workflow_work_items
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND id = $3`,
      [tenantId, workflowId, workItemId],
    );
    if (!result.rowCount) {
      throw new ValidationError('Workflow intervention work item must belong to the selected workflow');
    }
  }

  private async assertTask(tenantId: string, workflowId: string, taskId: string): Promise<void> {
    const result = await this.pool.query(
      `SELECT id
         FROM tasks
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND id = $3`,
      [tenantId, workflowId, taskId],
    );
    if (!result.rowCount) {
      throw new ValidationError('Workflow intervention task must belong to the selected workflow');
    }
  }
}

function toWorkflowInterventionRecord(
  row: WorkflowInterventionRow,
  fileRows: WorkflowInterventionFileRow[],
): WorkflowInterventionRecord {
  return {
    id: row.id,
    workflow_id: row.workflow_id,
    work_item_id: row.work_item_id,
    task_id: row.task_id,
    request_id: row.request_id,
    kind: row.kind,
    origin: row.origin,
    status: row.status,
    outcome: row.outcome,
    result_kind: row.result_kind,
    snapshot_version: row.snapshot_version,
    settings_revision: row.settings_revision === null ? null : Number(row.settings_revision),
    summary: row.summary,
    message: row.message,
    note: row.note,
    structured_action: sanitizeRecord(row.structured_action),
    metadata: sanitizeRecord(row.metadata),
    created_by_type: row.created_by_type,
    created_by_id: row.created_by_id,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    files: fileRows.map(toWorkflowInterventionFileRecord),
  };
}

function toWorkflowInterventionFileRecord(row: WorkflowInterventionFileRow): WorkflowInterventionFileRecord {
  return {
    id: row.id,
    file_name: row.file_name,
    description: row.description,
    content_type: row.content_type,
    size_bytes: Number(row.size_bytes),
    created_at: row.created_at.toISOString(),
    download_url: `/api/v1/workflows/${row.workflow_id}/interventions/${row.intervention_id}/files/${row.id}/content`,
  };
}

function sanitizeRequiredText(value: string, message: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ValidationError(message);
  }
  return trimmed;
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
