import { randomUUID } from 'node:crypto';

import type { LogService } from './log-service.js';
import { actorFromAuth } from './actor-context.js';
import { getRequestContext } from '../observability/request-context.js';

interface LogTaskContextAttachmentsInput {
  tenantId: string;
  task: Record<string, unknown>;
  summary: Record<string, unknown>;
}

export async function logTaskContextAttachments(
  logService: LogService | undefined,
  input: LogTaskContextAttachmentsInput,
): Promise<void> {
  if (!logService) {
    return;
  }

  const requestContext = getRequestContext();
  const actor = actorFromAuth(requestContext?.auth, {
    role: readOptionalString(input.task.role),
    isOrchestratorTask: readOptionalBoolean(input.task.is_orchestrator_task),
  });

  await logService.insert({
    tenantId: input.tenantId,
    traceId: requestContext?.requestId ?? randomUUID(),
    spanId: randomUUID(),
    source: 'platform',
    category: 'task_lifecycle',
    level: 'debug',
    operation: 'task.context.attachments',
    status: 'completed',
    payload: input.summary,
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

function readOptionalBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}
