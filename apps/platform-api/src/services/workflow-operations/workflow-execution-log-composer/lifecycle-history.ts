import type { LogRow } from '../../../logging/execution/log-service.js';
import type { WorkflowHistoryItem } from '../workflow-operations-types.js';

import { buildLinkedTargetIds } from './execution-scope.js';
import { asRecord, humanizeToken, normalizeTimestamp, readString } from './shared.js';
import { readLogSourceKind, readLogSourceLabel } from './execution-rendering.js';

const HISTORY_LIFECYCLE_OPERATIONS = new Set([
  'task_lifecycle.workflow.state_changed',
  'task_lifecycle.task.claimed',
  'task_lifecycle.task.started',
  'task_lifecycle.task.completed',
]);

export function buildLifecycleHistoryItems(rows: LogRow[]): WorkflowHistoryItem[] {
  return rows
    .filter((row) => HISTORY_LIFECYCLE_OPERATIONS.has(row.operation))
    .map((row) => ({
      item_id: `lifecycle-log:${row.id}`,
      item_kind: 'lifecycle_event',
      source_kind: readLogSourceKind(row),
      source_label: readLogSourceLabel(row),
      headline: buildLifecycleHeadline(row),
      summary: buildLifecycleSummary(row),
      created_at: normalizeTimestamp(row.created_at),
      work_item_id: row.work_item_id,
      task_id: row.task_id,
      linked_target_ids: buildLinkedTargetIds(row),
    }));
}

function buildLifecycleHeadline(row: LogRow): string {
  const payload = asRecord(row.payload);
  const entityName = readString(payload.entity_name) ?? row.task_title ?? 'Task';
  const sourceLabel = readLogSourceLabel(row);
  switch (row.operation) {
    case 'task_lifecycle.workflow.state_changed': {
      const nextState = readString(payload.to_state);
      return nextState ? `Workflow moved to ${humanizeToken(nextState)}` : 'Workflow state changed';
    }
    case 'task_lifecycle.task.claimed':
      return `${sourceLabel} claimed ${entityName}`;
    case 'task_lifecycle.task.started':
      return `${sourceLabel} started ${entityName}`;
    case 'task_lifecycle.task.completed':
      return `${sourceLabel} completed ${entityName}`;
    default:
      return humanizeToken(row.operation);
  }
}

function buildLifecycleSummary(row: LogRow): string {
  const payload = asRecord(row.payload);
  if (row.operation === 'task_lifecycle.workflow.state_changed') {
    const pieces = [
      readString(payload.from_state) ? `from ${humanizeToken(readString(payload.from_state)!)}` : null,
      readString(payload.to_state) ? `to ${humanizeToken(readString(payload.to_state)!)}` : null,
      (readString(payload.workflow_name) ?? row.workflow_name)
        ? `workflow ${readString(payload.workflow_name) ?? row.workflow_name}`
        : null,
    ].filter((value): value is string => value !== null);
    return pieces.length > 0 ? pieces.join(' · ') : 'Workflow state changed';
  }

  const requestId = readString(payload.request_id);
  const method = readString(payload.method);
  const action = readString(payload.action);
  const pieces = [
    action ? `action ${humanizeToken(action)}` : null,
    method ? `via ${method}` : null,
    requestId ? `request ${requestId}` : null,
  ].filter((value): value is string => value !== null);
  return pieces.length > 0 ? pieces.join(' · ') : humanizeToken(row.operation);
}
