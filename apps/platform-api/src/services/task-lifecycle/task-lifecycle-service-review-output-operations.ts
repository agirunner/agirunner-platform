import type { ApiKeyIdentity } from '../../auth/api-key.js';
import type { TaskLifecycleServiceOperationContext } from './task-lifecycle-service-types.js';
import {
  isJsonEquivalent,
  matchesReviewMetadata,
  normalizeTaskRecord,
} from './task-lifecycle-service-helpers.js';

export async function skipTask(
  context: TaskLifecycleServiceOperationContext,
  identity: ApiKeyIdentity,
  taskId: string,
  payload: { reason: string },
): Promise<Record<string, unknown>> {
  const task = normalizeTaskRecord(await context.deps.loadTaskOrThrow(identity.tenantId, taskId));
  if (
    task.state === 'completed' &&
    isJsonEquivalent(task.output, { skipped: true, reason: payload.reason }) &&
    matchesReviewMetadata(task, { action: 'skip', feedback: payload.reason })
  ) {
    return context.deps.toTaskResponse(task);
  }

  return context.applyStateTransition(identity, taskId, 'completed', {
    expectedStates: [
      'pending',
      'ready',
      'awaiting_approval',
      'output_pending_assessment',
      'failed',
      'cancelled',
    ],
    clearAssignment: true,
    clearLifecycleControlMetadata: true,
    clearEscalationMetadata: true,
    output: { skipped: true, reason: payload.reason },
    metadataPatch: {
      assessment_action: 'skip',
      assessment_feedback: payload.reason,
      assessment_updated_at: new Date().toISOString(),
    },
    reason: 'task_skipped',
  });
}

export async function overrideTaskOutput(
  context: TaskLifecycleServiceOperationContext,
  identity: ApiKeyIdentity,
  taskId: string,
  payload: { output: unknown; reason: string },
): Promise<Record<string, unknown>> {
  const task = normalizeTaskRecord(await context.deps.loadTaskOrThrow(identity.tenantId, taskId));
  if (
    task.state === 'completed' &&
    isJsonEquivalent(task.output, payload.output) &&
    matchesReviewMetadata(task, { action: 'override_output', feedback: payload.reason })
  ) {
    return context.deps.toTaskResponse(task);
  }

  return context.applyStateTransition(identity, taskId, 'completed', {
    expectedStates: ['output_pending_assessment', 'failed', 'cancelled', 'completed'],
    clearAssignment: true,
    clearLifecycleControlMetadata: true,
    clearEscalationMetadata: true,
    output: payload.output,
    metadataPatch: {
      assessment_action: 'override_output',
      assessment_feedback: payload.reason,
      assessment_updated_at: new Date().toISOString(),
    },
    reason: 'task_output_overridden',
  });
}
