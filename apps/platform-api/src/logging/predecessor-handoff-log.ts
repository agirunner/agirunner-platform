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

  await logService.insert({
    tenantId: input.tenantId,
    traceId: requestContext?.requestId ?? randomUUID(),
    spanId: randomUUID(),
    source: 'platform',
    category: 'task_lifecycle',
    level: 'info',
    operation: input.operation,
    status: 'completed',
    payload: {
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
      selected_handoff_id: readOptionalString(selectedHandoff?.id),
      selected_handoff_task_id: readOptionalString(selectedHandoff?.task_id),
      selected_handoff_role: readOptionalString(selectedHandoff?.role),
      selected_handoff_stage_name: readOptionalString(selectedHandoff?.stage_name),
      selected_handoff_sequence: readOptionalNumber(selectedHandoff?.sequence),
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
