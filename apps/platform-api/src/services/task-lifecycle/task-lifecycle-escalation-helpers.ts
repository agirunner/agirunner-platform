import type { ApiKeyIdentity } from '../../auth/api-key.js';
import type { DatabaseClient } from '../../db/database.js';
import { readPositiveInteger, readRequiredPositiveIntegerRuntimeDefault } from '../runtime-defaults/runtime-default-values.js';
import type { EventService } from '../event/event-service.js';
import type { ImmediateWorkflowActivationDispatcher } from '../workflow-activation/workflow-immediate-activation.js';
import { enqueueAndDispatchImmediatePlaybookActivation } from '../workflow-activation/workflow-immediate-activation.js';
import {
  loadOpenWorkItemEscalation,
  openWorkItemEscalation,
  resolveWorkItemEscalation,
} from '../work-item-service/work-item-escalations.js';
import { readAssessmentSubjectLinkage } from '../workflow-task-policy/assessment-subject-service.js';
import { readOptionalText } from './task-lifecycle-service-helpers.js';

export async function enqueuePlaybookActivationIfNeeded(input: {
  identity: ApiKeyIdentity;
  task: Record<string, unknown>;
  eventType: string;
  payload: Record<string, unknown>;
  client: DatabaseClient;
  eventService: EventService;
  activationDispatchService?: ImmediateWorkflowActivationDispatcher;
}): Promise<void> {
  const {
    identity,
    task,
    eventType,
    payload,
    client,
    eventService,
    activationDispatchService,
  } = input;
  if (task.is_orchestrator_task || typeof task.workflow_id !== 'string') {
    return;
  }

  await enqueueAndDispatchImmediatePlaybookActivation(
    client,
    eventService,
    activationDispatchService,
    {
      tenantId: identity.tenantId,
      workflowId: task.workflow_id,
      requestId: `${eventType}:${String(task.id)}:${new Date().toISOString()}`,
      reason: eventType,
      eventType,
      payload,
      actorType: 'system',
      actorId: 'task_lifecycle_service',
    },
  );
}

export async function maybeOpenTaskWorkItemEscalation(
  tenantId: string,
  task: Record<string, unknown>,
  reason: string,
  client: DatabaseClient,
): Promise<void> {
  const workflowId = readOptionalText(task.workflow_id);
  const workItemId = readOptionalText(task.work_item_id);
  const taskId = readOptionalText(task.id);
  if (!workflowId || !workItemId || !taskId) {
    return;
  }

  const linkage = readAssessmentSubjectLinkage(task.input, task.metadata);
  await openWorkItemEscalation(client, {
    tenantId,
    workflowId,
    workItemId,
    subjectRef: {
      kind: 'task',
      task_id: taskId,
      work_item_id: workItemId,
    },
    subjectRevision: linkage.subjectRevision,
    reason,
    createdByTaskId: taskId,
    closureEffect: 'blocking',
  });
}

export async function maybeResolveTaskWorkItemEscalation(
  tenantId: string,
  task: Record<string, unknown>,
  resolutionAction: 'dismiss' | 'unblock_subject' | 'reopen_subject',
  feedback: string | null,
  resolvedByType: string,
  resolvedById: string,
  client: DatabaseClient,
): Promise<void> {
  const workflowId = readOptionalText(task.workflow_id);
  const workItemId = readOptionalText(task.work_item_id);
  if (!workflowId || !workItemId) {
    return;
  }

  const openEscalation = await loadOpenWorkItemEscalation(client, tenantId, workflowId, workItemId);
  if (!openEscalation) {
    return;
  }

  await resolveWorkItemEscalation(client, {
    tenantId,
    workflowId,
    workItemId,
    escalationId: openEscalation.id,
    resolutionAction,
    feedback,
    resolvedByType,
    resolvedById,
  });
}

export async function resolveInheritedTaskTimeoutMinutes(input: {
  tenantId: string;
  explicitValue: unknown;
  client: DatabaseClient;
  defaultTaskTimeoutMinutes?: number;
  runtimeDefaultKey: string;
}): Promise<number> {
  const {
    tenantId,
    explicitValue,
    client,
    defaultTaskTimeoutMinutes,
    runtimeDefaultKey,
  } = input;
  const directValue = readPositiveInteger(explicitValue);
  if (directValue !== null) {
    return directValue;
  }

  if (
    typeof defaultTaskTimeoutMinutes === 'number'
    && Number.isInteger(defaultTaskTimeoutMinutes)
    && defaultTaskTimeoutMinutes > 0
  ) {
    return defaultTaskTimeoutMinutes;
  }

  return readRequiredPositiveIntegerRuntimeDefault(
    client,
    tenantId,
    runtimeDefaultKey,
  );
}
