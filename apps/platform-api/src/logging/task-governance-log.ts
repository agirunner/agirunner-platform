import { randomUUID } from 'node:crypto';

import type { DatabaseQueryable } from '../db/database.js';
import type { LogService } from './log-service.js';
import { actorFromAuth } from './actor-context.js';
import { getRequestContext } from '../observability/request-context.js';

interface LogTaskGovernanceTransitionInput {
  tenantId: string;
  operation: string;
  executor?: DatabaseQueryable;
  task: {
    id?: unknown;
    workflow_id?: unknown;
    work_item_id?: unknown;
    stage_name?: unknown;
    is_orchestrator_task?: unknown;
    title?: unknown;
    role?: unknown;
  };
  payload: Record<string, unknown>;
}

export async function logTaskGovernanceTransition(
  logService: LogService | undefined,
  input: LogTaskGovernanceTransitionInput,
): Promise<void> {
  if (!logService) {
    return;
  }

  const requestContext = getRequestContext();
  const actor = actorFromAuth(requestContext?.auth);
  const entry = {
    tenantId: input.tenantId,
    traceId: requestContext?.requestId ?? randomUUID(),
    spanId: randomUUID(),
    source: 'platform' as const,
    category: 'task_lifecycle' as const,
    level: 'info' as const,
    operation: input.operation,
    status: 'completed' as const,
    payload: input.payload,
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
    resourceType: 'task' as const,
    resourceId: readOptionalString(input.task.id),
    resourceName: readOptionalString(input.task.title),
  };

  try {
    if (input.executor && typeof logService.insertWithExecutor === 'function') {
      await logService.insertWithExecutor(input.executor, entry);
      return;
    }
    await logService.insert(entry);
  } catch {
    return;
  }
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readOptionalBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}
