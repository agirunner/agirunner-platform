import path from 'node:path';

import type { ArtifactStorageAdapter } from '../../content/artifact-storage.js';
import type { DatabaseQueryable } from '../../db/database.js';
import { sanitizeSecretLikeRecord } from '../secret-redaction.js';
import { TASK_CONTEXT_SECRET_REDACTION } from './task-context-constants.js';
import { asOptionalNumber, asOptionalString, asRecord, formatDateValue, readWorkflowIdArray, toWorkflowRelationRef } from './task-context-utils.js';
import { readLiveVisibilityMode, resolveOperatorExecutionContextId } from './task-context-anchor.js';

export function buildWorkflowContextBase(params: {
  workflowRow: Record<string, unknown>;
  activeStages: string[];
  workflowRelations: Record<string, unknown> | null;
  parentWorkflowContext: Record<string, unknown> | null;
  inputPackets: Record<string, unknown>[];
}) {
  const context: Record<string, unknown> = {
    id: params.workflowRow.id,
    name: params.workflowRow.name,
    lifecycle: params.workflowRow.lifecycle ?? null,
    active_stages: params.activeStages,
    context: params.workflowRow.context,
    git_branch: params.workflowRow.git_branch,
    resolved_config: sanitizeSecretLikeRecord(params.workflowRow.resolved_config, {
      redactionValue: TASK_CONTEXT_SECRET_REDACTION,
      allowSecretReferences: false,
    }),
    variables: sanitizeSecretLikeRecord(params.workflowRow.parameters, {
      redactionValue: TASK_CONTEXT_SECRET_REDACTION,
      allowSecretReferences: false,
    }),
    playbook: params.workflowRow.playbook_id
      ? {
          id: params.workflowRow.playbook_id,
          name: params.workflowRow.playbook_name ?? null,
          outcome: params.workflowRow.playbook_outcome ?? null,
          definition: params.workflowRow.playbook_definition ?? {},
        }
      : null,
    relations: params.workflowRelations,
    parent_workflow: params.parentWorkflowContext,
    input_packets: params.inputPackets,
  };
  return context;
}

export function buildContinuousWorkflowContext(params: {
  workflowRow: Record<string, unknown> & {
    lifecycle: 'ongoing';
  };
  activeStages: string[];
  workflowRelations: Record<string, unknown> | null;
  parentWorkflowContext: Record<string, unknown> | null;
  inputPackets: Record<string, unknown>[];
}) {
  return buildWorkflowContextBase(params);
}

export async function buildStandardWorkflowContext(params: {
  workflowRow: Record<string, unknown>;
  activeStages: string[];
  currentStage: string | null;
  workflowRelations: Record<string, unknown> | null;
  parentWorkflowContext: Record<string, unknown> | null;
  inputPackets: Record<string, unknown>[];
}) {
  const context = buildWorkflowContextBase(params);
  context.current_stage = params.currentStage;
  return context;
}

export async function loadWorkflowLiveVisibilityContext(
  db: DatabaseQueryable,
  tenantId: string,
  task: Record<string, unknown>,
  workflowRow: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const executionContextId = resolveOperatorExecutionContextId(task);
  if (!executionContextId) {
    return null;
  }
  const tenantMode = await readTenantLiveVisibilityMode(db, tenantId);
  const override = readLiveVisibilityMode(workflowRow.live_visibility_mode_override);
  const mode = override ?? tenantMode;
  return {
    mode,
    source: override ? 'workflow_override' : 'agentic_settings',
    revision: asOptionalNumber(workflowRow.live_visibility_revision) ?? 0,
    workflow_id: asOptionalString(workflowRow.id),
    work_item_id: asOptionalString(task.work_item_id),
    task_id: task.is_orchestrator_task === true ? null : asOptionalString(task.id),
    execution_context_id: executionContextId,
    source_kind: task.is_orchestrator_task === true ? 'orchestrator' : 'specialist',
    record_operator_brief_tool: 'record_operator_brief',
    turn_update_scope: null,
    eligible_turn_guidance: null,
    operator_brief_request_id_prefix: `operator-brief:${executionContextId}:`,
    milestone_briefs_required: true,
    terminal_briefs_required: task.is_orchestrator_task === true,
  };
}

export function isContinuousWorkflowRow(
  workflowRow: Record<string, unknown>,
): workflowRow is Record<string, unknown> & { lifecycle: 'ongoing' } {
  return workflowRow.lifecycle === 'ongoing';
}

export async function loadWorkflowRelations(
  db: DatabaseQueryable,
  tenantId: string,
  workflowRow: Record<string, unknown>,
) {
  const metadata = asRecord(workflowRow.metadata);
  const parentId = asOptionalString(metadata.parent_workflow_id);
  const childIds = readWorkflowIdArray(metadata.child_workflow_ids);
  const relatedIds = [...new Set([...(parentId ? [parentId] : []), ...childIds])];
  if (relatedIds.length === 0) {
    return {
      parent: null,
      children: [],
      latest_child_workflow_id: asOptionalString(metadata.latest_child_workflow_id) ?? null,
      child_status_counts: { total: 0, active: 0, completed: 0, failed: 0, cancelled: 0 },
    };
  }

  const relatedRes = await db.query(
    `SELECT w.id, w.name, w.state, w.playbook_id, w.created_at, w.started_at, w.completed_at,
            pb.name AS playbook_name
       FROM workflows w
       LEFT JOIN playbooks pb
         ON pb.tenant_id = w.tenant_id
        AND pb.id = w.playbook_id
      WHERE w.tenant_id = $1
        AND w.id = ANY($2::uuid[])`,
    [tenantId, relatedIds],
  );
  const relatedById = new Map(
    relatedRes.rows.map((row) => [
      String((row as Record<string, unknown>).id),
      row as Record<string, unknown>,
    ]),
  );
  const children = childIds.map((childId) =>
    toWorkflowRelationRef(childId, relatedById.get(childId)),
  );
  return {
    parent: parentId ? toWorkflowRelationRef(parentId, relatedById.get(parentId)) : null,
    children,
    latest_child_workflow_id: asOptionalString(metadata.latest_child_workflow_id) ?? null,
    child_status_counts: {
      total: children.length,
      active: children.filter(
        (child) =>
          child.state === 'pending' || child.state === 'active' || child.state === 'paused',
      ).length,
      completed: children.filter((child) => child.state === 'completed').length,
      failed: children.filter((child) => child.state === 'failed').length,
      cancelled: children.filter((child) => child.state === 'cancelled').length,
    },
  };
}

export async function loadParentWorkflowContext(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
) {
  const result = await db.query(
    `SELECT id, name, state, context, parameters, resolved_config, metadata, started_at, completed_at
       FROM workflows
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1`,
    [tenantId, workflowId],
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) {
    return null;
  }
  const metadata = asRecord(row.metadata);
  return {
    id: row.id,
    name: row.name,
    state: row.state,
    context: row.context ?? {},
    variables: row.parameters ?? {},
    resolved_config: row.resolved_config ?? {},
    started_at: row.started_at ?? null,
    completed_at: row.completed_at ?? null,
    run_summary: asRecord(metadata.run_summary),
  };
}

export async function loadWorkflowInputPackets(
  db: DatabaseQueryable,
  artifactStorage: ArtifactStorageAdapter | null,
  tenantId: string,
  workflowId: string,
): Promise<Record<string, unknown>[]> {
  const packetResult = await db.query(
    `SELECT id, work_item_id, packet_kind, source, summary, structured_inputs, metadata, created_at
       FROM workflow_input_packets
      WHERE tenant_id = $1
        AND workflow_id = $2
      ORDER BY created_at DESC`,
    [tenantId, workflowId],
  );
  if (packetResult.rows.length === 0) {
    return [];
  }

  const fileResult = await db.query(
    `SELECT id, packet_id, file_name, description, storage_key, content_type, size_bytes, created_at
       FROM workflow_input_packet_files
      WHERE tenant_id = $1
        AND workflow_id = $2
      ORDER BY created_at ASC`,
    [tenantId, workflowId],
  );

  const filesByPacket = new Map<string, Record<string, unknown>[]>();
  const taskContextFiles = await Promise.all(
    (fileResult.rows as Record<string, unknown>[]).map(async (row) =>
      buildWorkflowInputPacketTaskContextFile(row, artifactStorage),
    ),
  );
  for (const row of taskContextFiles) {
    const packetId = asOptionalString(row.packet_id);
    if (!packetId) {
      continue;
    }
    const files = filesByPacket.get(packetId) ?? [];
    const contextFile = asRecord(row.context_file);
    const fileRecord: Record<string, unknown> = {
      id: row.id,
      file_name: row.file_name,
      description: asOptionalString(row.description),
      content_type: asOptionalString(row.content_type),
      size_bytes: asOptionalNumber(row.size_bytes),
      created_at: formatDateValue(row.created_at),
    };
    if (Object.keys(contextFile).length > 0) {
      fileRecord.context_file = contextFile;
    } else {
      fileRecord.download_url = `/api/v1/workflows/${workflowId}/input-packets/${packetId}/files/${String(row.id)}/content`;
    }
    files.push(fileRecord);
    filesByPacket.set(packetId, files);
  }

  return (packetResult.rows as Record<string, unknown>[]).map((row) => ({
    id: row.id,
    work_item_id: asOptionalString(row.work_item_id),
    packet_kind: asOptionalString(row.packet_kind),
    source: asOptionalString(row.source),
    summary: asOptionalString(row.summary),
    structured_inputs: asRecord(row.structured_inputs),
    metadata: asRecord(row.metadata),
    created_at: formatDateValue(row.created_at),
    files: filesByPacket.get(String(row.id)) ?? [],
  }));
}

async function buildWorkflowInputPacketTaskContextFile(
  row: Record<string, unknown>,
  artifactStorage: ArtifactStorageAdapter | null,
): Promise<Record<string, unknown>> {
  const file = {
    ...row,
    context_file: null as Record<string, unknown> | null,
  };
  if (!artifactStorage) {
    return file;
  }

  const storageKey = asOptionalString(row.storage_key);
  const packetId = asOptionalString(row.packet_id);
  const fileId = asOptionalString(row.id);
  const fileName = asOptionalString(row.file_name);
  if (!storageKey || !packetId || !fileId || !fileName) {
    return file;
  }

  const payload = await artifactStorage.getObject(storageKey);
  file.context_file = {
    path: buildWorkflowInputPacketContextPath(packetId, fileId, fileName),
    content_base64: payload.data.toString('base64'),
  };
  return file;
}

function buildWorkflowInputPacketContextPath(
  packetId: string,
  fileId: string,
  fileName: string,
): string {
  return path.posix.join(
    '/workspace/context',
    'input-packets',
    packetId,
    'files',
    fileId,
    path.posix.basename(fileName),
  );
}

async function readTenantLiveVisibilityMode(
  db: DatabaseQueryable,
  tenantId: string,
): Promise<'standard' | 'enhanced'> {
  const result = await db.query<{ live_visibility_mode_default: string }>(
    `SELECT live_visibility_mode_default
       FROM agentic_settings
      WHERE tenant_id = $1`,
    [tenantId],
  );
  return readLiveVisibilityMode(result.rows[0]?.live_visibility_mode_default) ?? 'enhanced';
}
