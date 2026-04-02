import type { ApiKeyIdentity } from '../../auth/api-key.js';
import type { DatabaseClient } from '../../db/database.js';
import { ConflictError } from '../../errors/domain-errors.js';
import type { TaskState } from '../../orchestration/task-state-machine.js';
import { readPersistedLifecyclePolicy } from './task-lifecycle-policy.js';
import type { TaskLifecycleServiceOperationContext } from './task-lifecycle-service-types.js';
import {
  asRecord,
  hasActiveReworkRequest,
  hasAppliedLatestAssessmentRequest,
  hasMatchingAssessmentRejection,
  hasSupersedingTaskHandoffAfterAssessmentRequest,
  isJsonEquivalent,
  matchesReviewMetadata,
  normalizeTaskRecord,
  resolveRequestedChangesDescription,
} from './task-lifecycle-service-helpers.js';

export async function approveTask(
  context: TaskLifecycleServiceOperationContext,
  identity: ApiKeyIdentity,
  taskId: string,
  client?: DatabaseClient,
): Promise<Record<string, unknown>> {
  const currentTask = normalizeTaskRecord(
    await context.deps.loadTaskOrThrow(identity.tenantId, taskId, client),
  );
  if (
    (currentTask.state === 'ready' || currentTask.state === 'pending') &&
    matchesReviewMetadata(currentTask, { action: 'approve' })
  ) {
    return context.deps.toTaskResponse(currentTask);
  }

  return context.applyStateTransition(identity, taskId, 'ready', {
    expectedStates: ['awaiting_approval'],
    metadataPatch: {
      assessment_action: 'approve',
      assessment_updated_at: new Date().toISOString(),
    },
    afterUpdate: async (updatedTask, db) => {
      await context.deps.workItemContinuityService?.clearAssessmentExpectation(
        identity.tenantId,
        updatedTask,
        db,
      );
    },
    reason: 'approved',
  }, client);
}

export async function approveTaskOutput(
  context: TaskLifecycleServiceOperationContext,
  identity: ApiKeyIdentity,
  taskId: string,
  client?: DatabaseClient,
): Promise<Record<string, unknown>> {
  const currentTask = normalizeTaskRecord(
    await context.deps.loadTaskOrThrow(identity.tenantId, taskId, client),
  );
  if (currentTask.state === 'completed') {
    return context.deps.toTaskResponse(currentTask);
  }
  if (identity.scope === 'agent' && !currentTask.is_orchestrator_task && currentTask.workflow_id) {
    throw new ConflictError(
      'Agent-driven task output approval is not allowed for workflow specialist tasks; use formal assessment resolution instead.',
    );
  }

  return context.applyStateTransition(identity, taskId, 'completed', {
    expectedStates: ['output_pending_assessment'],
    clearLifecycleControlMetadata: true,
    clearEscalationMetadata: true,
    metadataPatch: {
      assessment_action: 'approve_output',
      assessment_updated_at: new Date().toISOString(),
    },
    afterUpdate: async (updatedTask, db) => {
      await context.deps.workItemContinuityService?.clearAssessmentExpectation(
        identity.tenantId,
        updatedTask,
        db,
      );
      await context.restoreOpenChildAssessmentWorkItemRouting(
        identity.tenantId,
        updatedTask,
        db,
      );
    },
    reason: 'output_assessment_approved',
  }, client);
}

export async function retryTask(
  context: TaskLifecycleServiceOperationContext,
  identity: ApiKeyIdentity,
  taskId: string,
  payload: { override_input?: Record<string, unknown>; force?: boolean } = {},
  client?: DatabaseClient,
): Promise<Record<string, unknown>> {
  const task = normalizeTaskRecord(
    await context.deps.loadTaskOrThrow(identity.tenantId, taskId, client),
  );
  if (
    (task.state === 'ready' || task.state === 'pending') &&
    task.assigned_agent_id == null &&
    task.assigned_worker_id == null
  ) {
    return context.deps.toTaskResponse(task);
  }

  const expectedStates: TaskState[] = payload.force
    ? ['failed', 'completed', 'ready', 'pending', 'awaiting_approval', 'output_pending_assessment', 'escalated']
    : ['failed'];
  if (!expectedStates.includes(task.state as TaskState)) {
    throw new ConflictError('Task is not retryable');
  }

  return context.applyStateTransition(identity, taskId, 'ready', {
    expectedStates,
    retryIncrement: true,
    clearAssignment: true,
    clearExecutionData: true,
    clearLifecycleControlMetadata: true,
    clearEscalationMetadata: true,
    overrideInput: payload.override_input,
    reason: payload.force ? 'manual_retry_forced' : 'manual_retry',
  }, client);
}

export async function cancelTask(
  context: TaskLifecycleServiceOperationContext,
  identity: ApiKeyIdentity,
  taskId: string,
  client?: DatabaseClient,
): Promise<Record<string, unknown>> {
  const task = normalizeTaskRecord(
    await context.deps.loadTaskOrThrow(identity.tenantId, taskId, client),
  );
  if (task.state === 'cancelled' || task.state === 'completed') {
    return context.deps.toTaskResponse(task);
  }

  if (
    (task.state === 'claimed' || task.state === 'in_progress') &&
    typeof task.assigned_worker_id === 'string' &&
    context.deps.queueWorkerCancelSignal
  ) {
    await context.deps.queueWorkerCancelSignal(
      identity,
      task.assigned_worker_id,
      taskId,
      'manual_cancel',
      new Date(),
    );
  }

  return context.applyStateTransition(identity, taskId, 'cancelled', {
    expectedStates: ['pending', 'ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_assessment', 'escalated', 'failed'],
    clearAssignment: true,
    clearLifecycleControlMetadata: true,
    clearEscalationMetadata: true,
    reason: 'cancelled',
  }, client);
}

export async function rejectTask(
  context: TaskLifecycleServiceOperationContext,
  identity: ApiKeyIdentity,
  taskId: string,
  payload: { feedback: string; record_continuity?: boolean },
  client?: DatabaseClient,
): Promise<Record<string, unknown>> {
  const task = normalizeTaskRecord(
    await context.deps.loadTaskOrThrow(identity.tenantId, taskId, client),
  );
  if (hasMatchingAssessmentRejection(task, payload.feedback)) {
    return context.deps.toTaskResponse(task);
  }

  return context.applyStateTransition(identity, taskId, 'failed', {
    expectedStates: ['awaiting_approval', 'output_pending_assessment', 'in_progress', 'claimed', 'completed'],
    clearAssignment: true,
    clearLifecycleControlMetadata: true,
    clearEscalationMetadata: true,
    error: { category: 'assessment_rejected', message: payload.feedback, recoverable: true },
    metadataPatch: {
      assessment_feedback: payload.feedback,
      assessment_action: 'reject',
      assessment_updated_at: new Date().toISOString(),
    },
    afterUpdate: async (updatedTask, db) => {
      if (payload.record_continuity !== false) {
        await context.deps.workItemContinuityService?.recordAssessmentRequestedChanges(
          identity.tenantId,
          updatedTask,
          db,
        );
      }
    },
    reason: 'assessment_rejected',
  }, client);
}

export async function requestTaskChanges(
  context: TaskLifecycleServiceOperationContext,
  identity: ApiKeyIdentity,
  taskId: string,
  payload: {
    feedback: string;
    override_input?: Record<string, unknown>;
    preferred_agent_id?: string;
    preferred_worker_id?: string;
  },
  client?: DatabaseClient,
): Promise<Record<string, unknown>> {
  const task = normalizeTaskRecord(
    await context.deps.loadTaskOrThrow(identity.tenantId, taskId, client),
  );
  if (hasActiveReworkRequest(task)) {
    return context.deps.toTaskResponse(task);
  }

  const latestAssessmentRequest = await context.loadLatestAssessmentRequestHandoff(
    identity.tenantId,
    task,
    client,
  );
  const latestTaskHandoffCreatedAt = await context.loadLatestTaskAttemptHandoffCreatedAt(
    identity.tenantId,
    task,
    client,
  );
  if (hasSupersedingTaskHandoffAfterAssessmentRequest(task, latestAssessmentRequest, latestTaskHandoffCreatedAt)) {
    return context.deps.toTaskResponse(task);
  }
  if (hasAppliedLatestAssessmentRequest(task, latestAssessmentRequest)) {
    return context.deps.toTaskResponse(task);
  }

  const overrideInput = payload.override_input ?? null;
  const nextInput = overrideInput ?? { ...asRecord(task.input), assessment_feedback: payload.feedback };
  const nextDescription = resolveRequestedChangesDescription(task, overrideInput, nextInput);
  const nextReworkInput = nextDescription ? { ...nextInput, description: nextDescription } : nextInput;
  if (
    (task.state === 'ready' || task.state === 'pending' || task.state === 'failed') &&
    isJsonEquivalent(task.input, nextReworkInput) &&
    matchesReviewMetadata(task, {
      action: 'request_changes',
      feedback: payload.feedback,
      preferredAgentId: payload.preferred_agent_id ?? undefined,
      preferredWorkerId: payload.preferred_worker_id ?? undefined,
    })
  ) {
    return context.deps.toTaskResponse(task);
  }

  const lifecyclePolicy = readPersistedLifecyclePolicy(task.metadata);
  const maxReworkCount = lifecyclePolicy?.rework?.max_cycles ?? 10;
  if (Number(task.rework_count ?? 0) + 1 > maxReworkCount) {
    return context.applyStateTransition(identity, taskId, 'failed', {
      expectedStates: ['awaiting_approval', 'output_pending_assessment', 'completed', 'failed', 'cancelled'],
      clearAssignment: true,
      clearLifecycleControlMetadata: true,
      reworkIncrement: true,
      metadataPatch: {
        assessment_feedback: payload.feedback,
        assessment_action: 'request_changes',
        assessment_updated_at: new Date().toISOString(),
        max_rework_exceeded_at: new Date().toISOString(),
        ...(latestAssessmentRequest
          ? {
              last_applied_assessment_request_handoff_id: latestAssessmentRequest.handoff_id,
              last_applied_assessment_request_task_id: latestAssessmentRequest.assessment_task_id,
            }
          : {}),
        ...(payload.preferred_agent_id ? { preferred_agent_id: payload.preferred_agent_id } : {}),
        ...(payload.preferred_worker_id ? { preferred_worker_id: payload.preferred_worker_id } : {}),
      },
      error: { category: 'max_rework_exceeded', message: payload.feedback, recoverable: false },
      afterUpdate: async (updatedTask, db) => {
        await context.deps.eventService.emit(
          {
            tenantId: identity.tenantId,
            type: 'task.max_rework_exceeded',
            entityType: 'task',
            entityId: taskId,
            actorType: identity.scope,
            actorId: identity.keyPrefix,
            data: { rework_count: updatedTask.rework_count, max_rework_count: maxReworkCount },
          },
          db,
        );
        await context.logGovernanceTransition(
          identity.tenantId,
          'task.max_rework_exceeded',
          updatedTask,
          {
            event_type: 'task.max_rework_exceeded',
            rework_count: updatedTask.rework_count ?? null,
            max_rework_count: maxReworkCount,
          },
          db,
        );
        await context.maybeCreateEscalationTask(
          identity,
          updatedTask,
          lifecyclePolicy,
          { category: 'max_rework_exceeded', retryable: false, recoverable: false },
          db,
        );
      },
      reason: 'max_rework_exceeded',
    }, client);
  }

  return context.applyStateTransition(identity, taskId, 'ready', {
    expectedStates: ['awaiting_approval', 'output_pending_assessment', 'completed', 'failed', 'cancelled'],
    clearAssignment: true,
    clearExecutionData: true,
    clearLifecycleControlMetadata: true,
    clearEscalationMetadata: true,
    reworkIncrement: true,
    retryIncrement: true,
    overrideInput: nextReworkInput,
    metadataPatch: {
      ...(nextDescription ? { description: nextDescription } : {}),
      assessment_feedback: payload.feedback,
      assessment_action: 'request_changes',
      assessment_updated_at: new Date().toISOString(),
      ...(latestAssessmentRequest
        ? {
            last_applied_assessment_request_handoff_id: latestAssessmentRequest.handoff_id,
            last_applied_assessment_request_task_id: latestAssessmentRequest.assessment_task_id,
          }
        : {}),
      ...(payload.preferred_agent_id ? { preferred_agent_id: payload.preferred_agent_id } : {}),
      ...(payload.preferred_worker_id ? { preferred_worker_id: payload.preferred_worker_id } : {}),
    },
    afterUpdate: async (updatedTask, db) => {
      await context.reopenCompletedWorkItemForRework(identity, updatedTask, db);
      await context.clearOpenChildAssessmentWorkItemRouting(identity.tenantId, updatedTask, db);
      await context.deps.workItemContinuityService?.recordAssessmentRequestedChanges(
        identity.tenantId,
        updatedTask,
        db,
      );
    },
    reason: 'assessment_requested_changes',
  }, client);
}

export async function reassignTask(
  context: TaskLifecycleServiceOperationContext,
  identity: ApiKeyIdentity,
  taskId: string,
  payload: { preferred_agent_id?: string; preferred_worker_id?: string; reason: string },
  client?: DatabaseClient,
): Promise<Record<string, unknown>> {
  const task = normalizeTaskRecord(
    await context.deps.loadTaskOrThrow(identity.tenantId, taskId, client),
  );
  if (
    (task.state === 'ready' || task.state === 'pending') &&
    matchesReviewMetadata(task, {
      action: 'reassign',
      feedback: payload.reason,
      preferredAgentId: payload.preferred_agent_id ?? null,
      preferredWorkerId: payload.preferred_worker_id ?? null,
    })
  ) {
    return context.deps.toTaskResponse(task);
  }

  if (
    (task.state === 'claimed' || task.state === 'in_progress') &&
    typeof task.assigned_worker_id === 'string' &&
    context.deps.queueWorkerCancelSignal
  ) {
    await context.deps.queueWorkerCancelSignal(
      identity,
      task.assigned_worker_id,
      taskId,
      'manual_cancel',
      new Date(),
    );
  }

  return context.applyStateTransition(identity, taskId, 'ready', {
    expectedStates: ['pending', 'ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_assessment', 'failed', 'cancelled'],
    clearAssignment: true,
    clearExecutionData: task.state === 'output_pending_assessment' || task.state === 'failed',
    clearLifecycleControlMetadata: true,
    clearEscalationMetadata: true,
    metadataPatch: {
      preferred_agent_id: payload.preferred_agent_id ?? null,
      preferred_worker_id: payload.preferred_worker_id ?? null,
      assessment_action: 'reassign',
      assessment_feedback: payload.reason,
      assessment_updated_at: new Date().toISOString(),
    },
    reason: 'task_reassigned',
  }, client);
}
