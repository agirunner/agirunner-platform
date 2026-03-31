import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';

import { DEFAULT_TENANT_ID } from './platform-env.js';
import {
  ApiRecord,
  SEED_BOARD_COLUMNS,
  WorkflowPacketSeedFile,
  sqlJsonValue,
  sqlText,
  sqlUuid,
} from './workflows-common.js';
import { runPsql } from './workflows-runtime.js';
import { writeSeededArtifactObject } from './workflows-storage.js';

export async function appendWorkflowEvent(workflowId: string, eventType: string, data: Record<string, unknown>): Promise<void> {
  runPsql(`
    INSERT INTO public.events (tenant_id, type, entity_type, entity_id, actor_type, actor_id, data)
    VALUES (
      '${DEFAULT_TENANT_ID}',
      ${sqlText(eventType)},
      'workflow',
      ${sqlText(workflowId)}::uuid,
      'admin',
      'playwright',
      ${sqlJsonValue({ workflow_id: workflowId, ...data })}::jsonb
    );
  `);
}

export async function appendWorkflowExecutionTurn(input: {
  workflowId: string;
  workflowName: string;
  workspaceId: string;
  workspaceName: string;
  workItemId: string;
  taskTitle: string;
  stageName: string;
  role: string;
  actorName: string;
  headline: string;
}): Promise<void> {
  runPsql(`
    SELECT create_execution_logs_partition(CURRENT_DATE);

    INSERT INTO public.execution_logs (
      tenant_id, trace_id, span_id,
      source, category, level, operation, status, payload,
      workspace_id, workflow_id, workflow_name, workspace_name,
      work_item_id, task_title, stage_name, is_orchestrator_task,
      role, actor_type, actor_id, actor_name,
      created_at
    )
    VALUES (
      '${DEFAULT_TENANT_ID}'::uuid,
      '${randomUUID()}'::uuid,
      '${randomUUID()}'::uuid,
      'runtime',
      'agent_loop',
      'info',
      'agent.plan',
      'completed',
      ${sqlJsonValue({ summary: input.headline })}::jsonb,
      ${sqlUuid(input.workspaceId)},
      ${sqlUuid(input.workflowId)},
      ${sqlText(input.workflowName)},
      ${sqlText(input.workspaceName)},
      ${sqlUuid(input.workItemId)},
      ${sqlText(input.taskTitle)},
      ${sqlText(input.stageName)},
      FALSE,
      ${sqlText(input.role)},
      'runtime',
      ${sqlText(`playwright:${input.role}`)},
      ${sqlText(input.actorName)},
      NOW()
    );
  `);
}

export async function createWorkflowDocumentRecord(input: {
  workflowId: string;
  workspaceId: string;
  logicalName: string;
  source: 'external' | 'artifact' | 'repository';
  title: string;
  description: string;
  location: string;
}): Promise<void> {
  runPsql(`
    INSERT INTO public.workflow_documents (
      id,
      tenant_id,
      workflow_id,
      workspace_id,
      task_id,
      logical_name,
      source,
      location,
      artifact_id,
      content_type,
      title,
      description,
      metadata,
      created_at
    )
    VALUES (
      ${sqlUuid(randomUUID())},
      ${sqlUuid(DEFAULT_TENANT_ID)},
      ${sqlUuid(input.workflowId)},
      ${sqlUuid(input.workspaceId)},
      NULL,
      ${sqlText(input.logicalName)},
      ${sqlText(input.source)},
      ${sqlText(input.location)},
      NULL,
      NULL,
      ${sqlText(input.title)},
      ${sqlText(input.description)},
      '{}'::jsonb,
      NOW()
    );
  `);
}

export async function createWorkflowInputPacketRecord(input: {
  workflowId: string;
  workItemId?: string;
  packetKind: string;
  summary: string;
  structuredInputs?: Record<string, unknown>;
  files: WorkflowPacketSeedFile[];
}): Promise<void> {
  const packetId = randomUUID();
  runPsql(`
    INSERT INTO public.workflow_input_packets (
      id,
      tenant_id,
      workflow_id,
      work_item_id,
      request_id,
      source_intervention_id,
      source_attempt_id,
      packet_kind,
      source,
      summary,
      structured_inputs,
      metadata,
      created_by_kind,
      created_by_type,
      created_by_id,
      created_at,
      updated_at
    )
    VALUES (
      ${sqlUuid(packetId)},
      ${sqlUuid(DEFAULT_TENANT_ID)},
      ${sqlUuid(input.workflowId)},
      ${input.workItemId ? sqlUuid(input.workItemId) : 'NULL'},
      ${sqlText(`playwright-packet:${packetId}`)},
      NULL,
      NULL,
      ${sqlText(input.packetKind)},
      'operator',
      ${sqlText(input.summary)},
      ${sqlJsonValue(input.structuredInputs ?? {})}::jsonb,
      '{}'::jsonb,
      'operator',
      'admin',
      'playwright',
      NOW(),
      NOW()
    );
  `);

  for (const file of input.files) {
    createWorkflowInputPacketFileRecord({
      workflowId: input.workflowId,
      packetId,
      file,
    });
  }
}

export async function createWorkItem(workflowId: string, body: Record<string, unknown>): Promise<ApiRecord> {
  const workItemId = randomUUID();
  runPsql(`
    INSERT INTO public.workflow_work_items (
      id,
      tenant_id,
      workflow_id,
      stage_name,
      title,
      goal,
      acceptance_criteria,
      column_id,
      owner_role,
      priority,
      notes,
      request_id,
      completed_at,
      metadata,
      created_at,
      updated_at
    )
    VALUES (
      ${sqlUuid(workItemId)},
      ${sqlUuid(DEFAULT_TENANT_ID)},
      ${sqlUuid(workflowId)},
      ${sqlText(String(body.stage_name ?? 'delivery'))},
      ${sqlText(String(body.title ?? 'Untitled work item'))},
      ${body.goal ? sqlText(String(body.goal)) : 'NULL'},
      ${body.acceptance_criteria ? sqlText(String(body.acceptance_criteria)) : 'NULL'},
      ${sqlText(String(body.column_id ?? SEED_BOARD_COLUMNS.planned))},
      ${body.owner_role ? sqlText(String(body.owner_role)) : 'NULL'},
      ${sqlText(String(body.priority ?? 'normal'))}::task_priority,
      ${body.notes ? sqlText(String(body.notes)) : 'NULL'},
      ${sqlText(randomUUID())},
      ${body.completed_at ? `${sqlText(String(body.completed_at))}::timestamptz` : 'NULL'},
      ${sqlJsonValue(body.metadata ?? {})}::jsonb,
      NOW(),
      NOW()
    );
  `);
  return { id: workItemId, title: String(body.title ?? 'Untitled work item'), workflow_id: workflowId };
}

export async function createTask(input: {
  workflowId: string;
  workspaceId: string;
  workItemId: string;
  stageName: string;
  title: string;
  role: string;
  state: 'claimed' | 'in_progress' | 'escalated' | 'awaiting_approval' | 'output_pending_assessment' | 'failed';
  description?: string;
  input?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}): Promise<ApiRecord> {
  const taskId = randomUUID();
  runPsql(`
    INSERT INTO public.tasks (
      id,
      tenant_id,
      workflow_id,
      workspace_id,
      work_item_id,
      stage_name,
      title,
      role,
      state,
      state_changed_at,
      input,
      metadata,
      created_at,
      updated_at,
      context
    )
    VALUES (
      ${sqlUuid(taskId)},
      ${sqlUuid(DEFAULT_TENANT_ID)},
      ${sqlUuid(input.workflowId)},
      ${sqlUuid(input.workspaceId)},
      ${sqlUuid(input.workItemId)},
      ${sqlText(input.stageName)},
      ${sqlText(input.title)},
      ${sqlText(input.role)},
      ${sqlText(input.state)}::task_state,
      NOW(),
      ${sqlJsonValue(input.input ?? {})}::jsonb,
      ${sqlJsonValue({
        ...(input.metadata ?? {}),
        ...(input.description ? { description: input.description } : {}),
      })}::jsonb,
      NOW(),
      NOW(),
      '{}'::jsonb
    );
  `);
  return { id: taskId, title: input.title, workflow_id: input.workflowId };
}

export async function appendWorkflowBrief(input: {
  workflowId: string;
  workItemId?: string;
  taskId?: string;
  executionContextId: string;
  headline: string;
  summary: string;
  sourceKind: string;
  sourceRoleName: string;
  linkedTargetIds?: string[];
}): Promise<void> {
  const requestId = `playwright-brief:${input.workflowId}:${input.executionContextId}:${createHash('sha1')
    .update(input.headline)
    .digest('hex')
    .slice(0, 12)}`;
  runPsql(`
    INSERT INTO public.workflow_operator_briefs (
      id, tenant_id, workflow_id, work_item_id, task_id,
      request_id, execution_context_id,
      brief_kind, brief_scope, source_kind, source_role_name, llm_turn_count, status_kind,
      short_brief, detailed_brief_json, linked_target_ids, sequence_number,
      related_artifact_ids, related_output_descriptor_ids, related_intervention_ids,
      canonical_workflow_brief_id, created_by_type, created_by_id, created_at, updated_at
    )
    VALUES (
      '${randomUUID()}'::uuid,
      '${DEFAULT_TENANT_ID}'::uuid,
      ${sqlUuid(input.workflowId)},
      ${input.workItemId ? sqlUuid(input.workItemId) : 'NULL'},
      ${input.taskId ? sqlUuid(input.taskId) : 'NULL'},
      ${sqlText(requestId)},
      ${sqlText(input.executionContextId)},
      'milestone',
      'workflow_timeline',
      ${sqlText(input.sourceKind)},
      ${sqlText(input.sourceRoleName)},
      NULL,
      'handoff',
      ${sqlJsonValue({ headline: input.headline })}::jsonb,
      ${sqlJsonValue({
        headline: input.headline,
        status_kind: 'handoff',
        summary: input.summary,
      })}::jsonb,
      ${sqlJsonValue(input.linkedTargetIds ?? [input.workflowId, input.workItemId].filter(Boolean))}::jsonb,
      1,
      '[]'::jsonb,
      '[]'::jsonb,
      '[]'::jsonb,
      NULL,
      'admin',
      'playwright',
      NOW(),
      NOW()
    );
  `);
}

function createWorkflowInputPacketFileRecord(input: {
  workflowId: string;
  packetId: string;
  file: WorkflowPacketSeedFile;
}): void {
  const fileId = randomUUID();
  const payload = Buffer.from(input.file.content, 'utf8');
  const storageKey = `tenants/${DEFAULT_TENANT_ID}/workflows/${input.workflowId}/input-packets/${input.packetId}/files/${fileId}/${input.file.fileName}`;
  const checksumSha256 = createHash('sha256').update(payload).digest('hex');
  writeSeededArtifactObject(storageKey, payload, input.file.contentType);
  runPsql(`
    INSERT INTO public.workflow_input_packet_files (
      id,
      tenant_id,
      workflow_id,
      packet_id,
      file_name,
      description,
      storage_backend,
      storage_key,
      content_type,
      size_bytes,
      checksum_sha256,
      created_at
    )
    VALUES (
      ${sqlUuid(fileId)},
      ${sqlUuid(DEFAULT_TENANT_ID)},
      ${sqlUuid(input.workflowId)},
      ${sqlUuid(input.packetId)},
      ${sqlText(input.file.fileName)},
      NULL,
      'local',
      ${sqlText(storageKey)},
      ${sqlText(input.file.contentType)},
      ${payload.byteLength},
      ${sqlText(checksumSha256)},
      NOW()
    );
  `);
}
