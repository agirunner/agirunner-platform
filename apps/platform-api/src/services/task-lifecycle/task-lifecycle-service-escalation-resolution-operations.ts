import type { ApiKeyIdentity } from '../../auth/api-key.js';
import { ConflictError } from '../../errors/domain-errors.js';
import type { TaskLifecycleServiceOperationContext } from './task-lifecycle-service-types.js';
import {
  asRecord,
  isJsonEquivalent,
  normalizeTaskRecord,
} from './task-lifecycle-service-helpers.js';

export async function respondToEscalation(
  context: TaskLifecycleServiceOperationContext,
  identity: ApiKeyIdentity,
  taskId: string,
  payload: { instructions: string; context?: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  const task = normalizeTaskRecord(await context.deps.loadTaskOrThrow(identity.tenantId, taskId));
  const escalationTaskId = readEscalationTaskId(task);
  if (!escalationTaskId) {
    throw new ConflictError('Task does not have a pending escalation task');
  }

  const escalationTask = normalizeTaskRecord(
    await context.deps.loadTaskOrThrow(identity.tenantId, escalationTaskId),
  );
  const existingEscalationResponse = asRecord(asRecord(escalationTask.input).human_escalation_response);
  if (
    existingEscalationResponse.instructions === payload.instructions &&
    isJsonEquivalent(existingEscalationResponse.context ?? {}, payload.context ?? {}) &&
    typeof asRecord(escalationTask.metadata).human_escalation_response_at === 'string'
  ) {
    return context.deps.toTaskResponse(escalationTask);
  }

  const client = await context.deps.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE tasks
          SET input = $3::jsonb,
              metadata = metadata || $4::jsonb,
              updated_at = now()
        WHERE tenant_id = $1
          AND id = $2`,
      [
        identity.tenantId,
        escalationTaskId,
        {
          ...asRecord(escalationTask.input),
          human_escalation_response: {
            instructions: payload.instructions,
            context: payload.context ?? {},
            responded_at: new Date().toISOString(),
            responded_by: identity.keyPrefix,
          },
        },
        { human_escalation_response_at: new Date().toISOString() },
      ],
    );
    await context.deps.eventService.emit(
      {
        tenantId: identity.tenantId,
        type: 'task.escalation_response_recorded',
        entityType: 'task',
        entityId: taskId,
        actorType: identity.scope,
        actorId: identity.keyPrefix,
        data: { escalation_task_id: escalationTaskId },
      },
      client,
    );
    await context.logGovernanceTransition(
      identity.tenantId,
      'task.escalation.response_recorded',
      task,
      {
        event_type: 'task.escalation_response_recorded',
        escalation_task_id: escalationTaskId,
      },
      client,
    );
    await client.query('COMMIT');
    return context.deps.toTaskResponse(
      normalizeTaskRecord(
        await context.deps.loadTaskOrThrow(identity.tenantId, escalationTaskId),
      ),
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function resolveEscalation(
  context: TaskLifecycleServiceOperationContext,
  identity: ApiKeyIdentity,
  taskId: string,
  payload: {
    instructions: string;
    context?: Record<string, unknown>;
  },
): Promise<Record<string, unknown>> {
  const currentTask = normalizeTaskRecord(await context.deps.loadTaskOrThrow(identity.tenantId, taskId));
  const existingResolution = asRecord(asRecord(currentTask.input).escalation_resolution);
  if (
    currentTask.state === 'ready' &&
    existingResolution.instructions === payload.instructions &&
    isJsonEquivalent(existingResolution.context ?? {}, payload.context ?? {})
  ) {
    return context.deps.toTaskResponse(currentTask);
  }
  if (currentTask.state !== 'escalated') {
    throw new ConflictError('Task is not awaiting escalation');
  }

  const client = await context.deps.pool.connect();
  try {
    await client.query('BEGIN');
    const task = normalizeTaskRecord(
      await context.deps.loadTaskOrThrow(identity.tenantId, taskId, client),
    );
    if (task.state !== 'escalated') {
      throw new ConflictError('Task is not awaiting escalation');
    }

    const hasCurrentAttemptHandoff =
      (await context.loadLatestTaskAttemptHandoffCreatedAt(identity.tenantId, task, client)) !== null;
    const result = await context.applyStateTransition(
      identity,
      taskId,
      hasCurrentAttemptHandoff ? 'completed' : 'ready',
      {
        expectedStates: ['escalated'],
        clearAssignment: true,
        clearExecutionData: !hasCurrentAttemptHandoff,
        clearLifecycleControlMetadata: true,
        overrideInput: {
          ...asRecord(task.input),
          escalation_resolution: {
            resolved_by: 'human',
            instructions: payload.instructions,
            context: payload.context ?? {},
            resolved_at: new Date().toISOString(),
            resolved_by_user: identity.keyPrefix,
          },
        },
        metadataPatch: { escalation_awaiting_human: null },
        afterUpdate: async (_updatedTask, updateClient) => {
          await context.maybeResolveTaskWorkItemEscalation(
            identity.tenantId,
            task,
            'unblock_subject',
            payload.instructions,
            identity.ownerType,
            identity.keyPrefix,
            updateClient,
          );
          await context.enqueuePlaybookActivationIfNeeded(identity, task, 'task.escalation_resolved', {
            task_id: taskId,
            task_role: task.role ?? null,
            task_title: task.title ?? null,
            work_item_id: task.work_item_id ?? null,
            stage_name: task.stage_name ?? null,
            resolved_by: 'human',
            resolution_preview: payload.instructions.slice(0, 200),
          }, updateClient);
          await context.deps.eventService.emit(
            {
              tenantId: identity.tenantId,
              type: 'task.escalation_resolved',
              entityType: 'task',
              entityId: taskId,
              actorType: identity.scope,
              actorId: identity.keyPrefix,
              data: {
                resolved_by: 'human',
                resolution_preview: payload.instructions.slice(0, 200),
              },
            },
            updateClient,
          );
        },
        reason: 'escalation_resolved',
      },
      client,
    );
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function readEscalationTaskId(task: Record<string, unknown>): string | null {
  const value = asRecord(task.metadata).escalation_task_id;
  return typeof value === 'string' ? value : null;
}
