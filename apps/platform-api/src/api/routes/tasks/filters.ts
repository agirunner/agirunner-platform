import { z } from 'zod';

import { ValidationError } from '../../../errors/domain-errors.js';
import type { PublicTaskState, TaskExecutionBackend } from '../../../services/task/task-service.types.js';

const publicTaskStateFilters = new Set<PublicTaskState>([
  'pending',
  'ready',
  'claimed',
  'in_progress',
  'awaiting_approval',
  'output_pending_assessment',
  'escalated',
  'completed',
  'failed',
  'cancelled',
]);

export function parseTaskStateFilter(value: string | undefined) {
  if (value === undefined) {
    return undefined;
  }
  if (!publicTaskStateFilters.has(value as PublicTaskState)) {
    throw new ValidationError(`Invalid task state '${value}'`);
  }
  return value;
}

export function parseExecutionBackendFilter(value: string | undefined): TaskExecutionBackend | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === 'runtime_only' || value === 'runtime_plus_task') {
    return value;
  }
  throw new ValidationError(`Invalid execution backend '${value}'`);
}

export function parseTaskId(id: string) {
  const result = z.string().uuid().safeParse(id);
  if (result.success) {
    return result.data;
  }
  throw new ValidationError('task id must be a valid uuid');
}

export function parseOptionalUuidFilter(value: string | undefined, label: string) {
  if (value === undefined) {
    return undefined;
  }
  const result = z.string().uuid().safeParse(value);
  if (result.success) {
    return result.data;
  }
  throw new ValidationError(`${label} must be a valid uuid`);
}

export async function assertRawTaskOperatorActionAllowed(
  loadTask: (tenantId: string, taskId: string) => Promise<unknown>,
  tenantId: string,
  taskId: string,
) {
  const task = (await loadTask(tenantId, taskId)) as { workflow_id?: string | null } | null;
  if (task?.workflow_id) {
    throw new ValidationError(
      'Workflow-linked task operator actions must run from the workflow or work-item operator flow.',
    );
  }
}
