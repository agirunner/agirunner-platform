import { randomUUID } from 'node:crypto';

import type { LogService } from './log-service.js';
import { actorFromAuth } from './actor-context.js';
import { getRequestContext } from '../observability/request-context.js';
import type { RelevantHandoffResolution } from '../services/predecessor-handoff-resolver.js';

interface LogPredecessorHandoffResolutionInput {
  tenantId: string;
  operation: string;
  task: Record<string, unknown>;
  resolution: RelevantHandoffResolution;
  contextAnchor?: Record<string, unknown> | null;
}

export async function logPredecessorHandoffResolution(
  logService: LogService | undefined,
  input: LogPredecessorHandoffResolutionInput,
): Promise<void> {
  if (!logService) {
    return;
  }

  const requestContext = getRequestContext();
  const actor = actorFromAuth(requestContext?.auth);
  const selectedHandoff = input.resolution.handoffs[0] ?? null;
  const candidateHandoffIds = input.resolution.handoffs
    .map((handoff) => readOptionalString(handoff.id))
    .filter((handoffId): handoffId is string => handoffId !== null);
  const candidateTaskIds = input.resolution.handoffs
    .map((handoff) => readOptionalString(handoff.task_id))
    .filter((taskId): taskId is string => taskId !== null);

  await logService.insert({
    tenantId: input.tenantId,
    traceId: requestContext?.requestId ?? randomUUID(),
    spanId: randomUUID(),
    source: 'platform',
    category: 'task_lifecycle',
    level: 'debug',
    operation: input.operation,
    status: 'completed',
    payload: {
      current_workflow_id: readOptionalString(input.task.workflow_id),
      current_work_item_id: readOptionalString(input.task.work_item_id),
      current_task_id: readOptionalString(input.task.id),
      context_anchor_source: readOptionalString(input.contextAnchor?.source),
      context_anchor_event_type: readOptionalString(input.contextAnchor?.event_type),
      context_anchor_work_item_id: readOptionalString(input.contextAnchor?.work_item_id),
      context_anchor_stage_name: readOptionalString(input.contextAnchor?.stage_name),
      context_anchor_triggering_task_id: readOptionalString(input.contextAnchor?.triggering_task_id),
      resolution_source: input.resolution.source,
      has_predecessor_handoff: Boolean(selectedHandoff),
      source_work_item_id: input.resolution.source_work_item_id,
      parent_work_item_id: input.resolution.parent_work_item_id,
      sibling_count: input.resolution.sibling_count,
      local_candidate_count:
        input.resolution.source === 'local_work_item'
          ? input.resolution.handoffs.length
          : 0,
      parent_candidate_count:
        input.resolution.source === 'parent_work_item'
          ? input.resolution.handoffs.length
          : 0,
      candidate_handoff_ids: candidateHandoffIds,
      candidate_task_ids: candidateTaskIds,
      selected_handoff_id: readOptionalString(selectedHandoff?.id),
      selected_handoff_workflow_id: readOptionalString(selectedHandoff?.workflow_id),
      selected_handoff_work_item_id: readOptionalString(selectedHandoff?.work_item_id),
      selected_handoff_task_id: readOptionalString(selectedHandoff?.task_id),
      selected_handoff_role: readOptionalString(selectedHandoff?.role),
      selected_handoff_stage_name: readOptionalString(selectedHandoff?.stage_name),
      selected_handoff_sequence: readOptionalNumber(selectedHandoff?.sequence),
      selected_handoff_created_at: readOptionalTimestamp(selectedHandoff?.created_at),
    },
    workflowId: readOptionalString(input.task.workflow_id),
    taskId: readOptionalString(input.task.id),
    workItemId: readOptionalString(input.task.work_item_id),
    stageName: readOptionalString(input.task.stage_name),
    isOrchestratorTask: readOptionalBoolean(input.task.is_orchestrator_task),
    taskTitle: readOptionalString(input.task.title),
    role: readOptionalString(input.task.role),
    actorType: actor.type,
    actorId: actor.id,
    actorName: actor.name,
    resourceType: 'task',
    resourceId: readOptionalString(input.task.id),
    resourceName: readOptionalString(input.task.title),
  });
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readOptionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readOptionalBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function readOptionalTimestamp(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? value : new Date(timestamp).toISOString();
}
