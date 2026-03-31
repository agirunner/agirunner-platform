import type { DatabaseQueryable } from '../../db/database.js';
import { asOptionalNumber, asOptionalString, asRecord, readPositiveInteger } from './task-context-utils.js';
import { DEFAULT_ASSEMBLED_PROMPT_WARNING_THRESHOLD_CHARS } from './task-context-constants.js';

export interface TaskContextAnchor {
  source: 'task' | 'activation_event' | 'none';
  event_type: string | null;
  work_item_id: string | null;
  stage_name: string | null;
  triggering_task_id: string | null;
}

export function buildOrchestratorExecutionBrief(
  workflowLiveVisibility: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!workflowLiveVisibility) {
    return null;
  }
  return {
    operator_visibility: workflowLiveVisibility,
  };
}

export function resolveTaskContextAnchor(task: Record<string, unknown>): TaskContextAnchor {
  const workItemId = asOptionalString(task.work_item_id) ?? null;
  const stageName = asOptionalString(task.stage_name) ?? null;
  if (workItemId) {
    return {
      source: 'task',
      event_type: null,
      work_item_id: workItemId,
      stage_name: stageName,
      triggering_task_id: null,
    };
  }

  const activationEvent = readActivationEventAnchor(asRecord(task.input));
  if (activationEvent) {
    return {
      source: 'activation_event',
      event_type: activationEvent.event_type,
      work_item_id: activationEvent.work_item_id,
      stage_name: activationEvent.stage_name,
      triggering_task_id: activationEvent.triggering_task_id,
    };
  }

  if (stageName) {
    return {
      source: 'task',
      event_type: null,
      work_item_id: null,
      stage_name: stageName,
      triggering_task_id: null,
    };
  }

  return {
    source: 'none',
    event_type: null,
    work_item_id: null,
    stage_name: null,
    triggering_task_id: null,
  };
}

export function applyTaskContextAnchor(
  task: Record<string, unknown>,
  contextAnchor: TaskContextAnchor,
): Record<string, unknown> {
  if (contextAnchor.source === 'none') {
    return task;
  }

  return {
    ...task,
    work_item_id: contextAnchor.work_item_id ?? task.work_item_id,
    stage_name: contextAnchor.stage_name ?? task.stage_name,
  };
}

export async function readTenantAssembledPromptWarningThreshold(
  db: DatabaseQueryable,
  tenantId: string,
): Promise<number> {
  const result = await db.query<{ assembled_prompt_warning_threshold_chars: number }>(
    `SELECT assembled_prompt_warning_threshold_chars
       FROM agentic_settings
      WHERE tenant_id = $1`,
    [tenantId],
  );
  return (
    readPositiveInteger(result.rows[0]?.assembled_prompt_warning_threshold_chars) ??
    DEFAULT_ASSEMBLED_PROMPT_WARNING_THRESHOLD_CHARS
  );
}

export function readLiveVisibilityMode(value: unknown): 'standard' | 'enhanced' | null {
  return value === 'standard' || value === 'enhanced' ? value : null;
}

export function resolveOperatorExecutionContextId(task: Record<string, unknown>): string | null {
  if (task.is_orchestrator_task === true) {
    return asOptionalString(task.activation_id) ?? asOptionalString(task.id) ?? null;
  }
  return asOptionalString(task.id) ?? null;
}

function readActivationEventAnchor(
  taskInput: Record<string, unknown>,
): Omit<TaskContextAnchor, 'source'> | null {
  const events = Array.isArray(taskInput.events) ? taskInput.events : [];
  for (const entry of events) {
    const event = asRecord(entry);
    const payload = asRecord(event.payload);
    const workItemId =
      asOptionalString(event.work_item_id) ?? asOptionalString(payload.work_item_id) ?? null;
    const stageName =
      asOptionalString(event.stage_name) ?? asOptionalString(payload.stage_name) ?? null;
    const triggeringTaskId =
      asOptionalString(event.task_id) ?? asOptionalString(payload.task_id) ?? null;
    const eventType = asOptionalString(event.type) ?? asOptionalString(event.event_type) ?? null;
    if (!workItemId && !stageName && !triggeringTaskId) {
      continue;
    }
    return {
      event_type: eventType,
      work_item_id: workItemId,
      stage_name: stageName,
      triggering_task_id: triggeringTaskId,
    };
  }
  return null;
}
