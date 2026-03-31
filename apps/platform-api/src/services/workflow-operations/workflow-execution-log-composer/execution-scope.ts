import type { LogRow } from '../../../logging/log-service.js';

import { asRecord, dedupeIds, readString } from './shared.js';

export function resolveExecutionTurnScope(row: LogRow): {
  binding: 'structured_target' | 'execution_context';
  workItemId: string | null;
  taskId: string | null;
  linkedTargetIds: string[];
} {
  const payload = asRecord(row.payload);
  const targets = extractStructuredTargetIds(readStructuredTargetPayload(row, payload));
  if (targets.workItemIds.length === 0 && targets.taskIds.length === 0) {
    return {
      binding: 'execution_context',
      workItemId: row.work_item_id,
      taskId: row.task_id,
      linkedTargetIds: buildLinkedTargetIds(row),
    };
  }

  return {
    binding: 'structured_target',
    workItemId: targets.workItemIds[0] ?? row.work_item_id,
    taskId: targets.taskIds[0] ?? row.task_id,
    linkedTargetIds: dedupeIds([
      row.workflow_id,
      row.work_item_id,
      row.task_id,
      ...targets.workItemIds,
      ...targets.taskIds,
    ]),
  };
}

export function buildLinkedTargetIds(row: LogRow): string[] {
  return dedupeIds([row.workflow_id, row.work_item_id, row.task_id]);
}

function readStructuredTargetPayload(
  row: LogRow,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (row.operation !== 'llm.chat_stream') {
    return asRecord(payload.input);
  }
  return {
    response_tool_calls: payload.response_tool_calls,
  };
}

function extractStructuredTargetIds(input: Record<string, unknown>): {
  workItemIds: string[];
  taskIds: string[];
} {
  const workItemIds = new Set<string>();
  const taskIds = new Set<string>();
  collectStructuredTargetIds(input, workItemIds, taskIds);
  return {
    workItemIds: Array.from(workItemIds),
    taskIds: Array.from(taskIds),
  };
}

function collectStructuredTargetIds(
  value: unknown,
  workItemIds: Set<string>,
  taskIds: Set<string>,
): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectStructuredTargetIds(entry, workItemIds, taskIds);
    }
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }

  const record = value as Record<string, unknown>;
  for (const [key, entry] of Object.entries(record)) {
    if (key === 'target_id') {
      const targetType = readString(record.target_type);
      const targetId = readString(entry);
      if (targetType === 'work_item' && targetId) {
        workItemIds.add(targetId);
      }
      if (targetType === 'task' && targetId) {
        taskIds.add(targetId);
      }
      continue;
    }
    if (key === 'work_item_id' || key.endsWith('_work_item_id')) {
      const workItemId = readString(entry);
      if (workItemId) {
        workItemIds.add(workItemId);
      }
      continue;
    }
    if (key === 'task_id' || key.endsWith('_task_id')) {
      const taskId = readString(entry);
      if (taskId) {
        taskIds.add(taskId);
      }
      continue;
    }
    collectStructuredTargetIds(entry, workItemIds, taskIds);
  }
}
