import type { ApiKeyIdentity } from '../../auth/api-key.js';
import type { DatabaseClient } from '../../db/database.js';
import { validateOutputSchema } from '../../validation/output-validator.js';
import { registerTaskOutputDocuments } from '../document-reference/document-reference-service.js';
import { applyOutputStateDeclarations } from '../task-output-storage.js';
import { readPersistedLifecyclePolicy } from '../task-lifecycle-policy.js';
import {
  sanitizeSecretLikeRecord,
  sanitizeSecretLikeValue,
} from '../secret-redaction.js';
import type { TaskLifecycleServiceOperationContext } from './task-lifecycle-service-types.js';
import {
  buildOutputRevisionMetadataPatch,
  classifyFailure,
  isCancelledOrCompletedTask,
  isFailTaskReplay,
  isJsonEquivalent,
  normalizeTaskRecord,
  type FailureClassification,
} from './task-lifecycle-service-helpers.js';
import { buildRetryPlan } from './task-lifecycle-service-helpers.js';

export async function startTask(
  context: TaskLifecycleServiceOperationContext,
  identity: ApiKeyIdentity,
  taskId: string,
  payload: { agent_id?: string; worker_id?: string; started_at?: string },
  existingClient?: DatabaseClient,
): Promise<Record<string, unknown>> {
  const assignment = context.requireLifecycleIdentity(identity, payload);
  const task = normalizeTaskRecord(
    await context.deps.loadTaskOrThrow(identity.tenantId, taskId, existingClient),
  );

  if (
    task.state === 'in_progress' &&
    (!assignment.agentId || task.assigned_agent_id === assignment.agentId) &&
    (!assignment.workerId || task.assigned_worker_id === assignment.workerId)
  ) {
    return context.deps.toTaskResponse(task);
  }

  const startedAt = payload.started_at ? new Date(payload.started_at) : undefined;
  return context.applyStateTransition(identity, taskId, 'in_progress', {
    expectedStates: ['claimed'],
    requireAssignment: assignment,
    reason: 'task_started',
    startedAt: startedAt && Number.isFinite(startedAt.getTime()) ? startedAt : undefined,
  }, existingClient);
}

export async function completeTask(
  context: TaskLifecycleServiceOperationContext,
  identity: ApiKeyIdentity,
  taskId: string,
  payload: {
    output: unknown;
    metrics?: Record<string, unknown>;
    git_info?: Record<string, unknown>;
    verification?: Record<string, unknown>;
    agent_id?: string;
    worker_id?: string;
  },
  existingClient?: DatabaseClient,
): Promise<Record<string, unknown>> {
  const assignment = context.requireLifecycleIdentity(identity, payload);
  const task = normalizeTaskRecord(
    await context.deps.loadTaskOrThrow(identity.tenantId, taskId, existingClient),
  );
  const sanitizedOutput = sanitizeSecretLikeValue(payload.output);

  if (
    (task.state === 'completed' || task.state === 'output_pending_assessment') &&
    isJsonEquivalent(task.output, sanitizedOutput)
  ) {
    return context.deps.toTaskResponse(task);
  }

  await context.deps.handoffService?.assertRequiredTaskHandoffBeforeCompletion(
    identity.tenantId,
    task,
    existingClient,
  );
  await context.assertOperatorReportingBeforeCompletion(
    identity.tenantId,
    task,
    existingClient,
  );

  const outputValidation = validateOutputSchema(
    payload.output,
    context.extractOutputSchema(task),
  );
  const verificationPassed = context.readVerificationPassed(payload.verification, payload.metrics);
  const persisted = context.deps.artifactService
    ? await applyOutputStateDeclarations(
        context.deps.artifactService,
        identity,
        task,
        payload.output,
        payload.git_info,
      )
    : {
        output: payload.output,
        gitInfo: payload.git_info,
        cleanupArtifactIds: [],
      };

  const safeOutput = sanitizeSecretLikeValue(persisted.output);
  const safeMetrics = payload.metrics ? sanitizeSecretLikeRecord(payload.metrics) : undefined;
  const safeGitInfo = persisted.gitInfo
    ? sanitizeSecretLikeRecord(persisted.gitInfo)
    : undefined;
  const safeVerification = payload.verification
    ? sanitizeSecretLikeRecord(payload.verification)
    : undefined;
  const outputRevisionMetadataPatch = buildOutputRevisionMetadataPatch(task);
  const shouldMoveToOutputAssessment = !outputValidation.valid || verificationPassed === false;

  try {
    return shouldMoveToOutputAssessment
      ? await context.applyStateTransition(identity, taskId, 'output_pending_assessment', {
          expectedStates: ['in_progress'],
          requireAssignment: assignment,
          output: safeOutput,
          metrics: safeMetrics,
          gitInfo: safeGitInfo,
          verification: safeVerification,
          metadataPatch: outputRevisionMetadataPatch,
          clearAssignment: true,
          clearLifecycleControlMetadata: true,
          clearEscalationMetadata: true,
          reason: !outputValidation.valid
            ? 'output_schema_assessment_required'
            : 'verification_assessment_required',
        }, existingClient)
      : await context.applyStateTransition(identity, taskId, 'completed', {
          expectedStates: ['in_progress'],
          requireAssignment: assignment,
          output: safeOutput,
          metrics: safeMetrics,
          gitInfo: safeGitInfo,
          verification: safeVerification,
          metadataPatch: outputRevisionMetadataPatch,
          clearAssignment: true,
          clearLifecycleControlMetadata: true,
          clearEscalationMetadata: true,
          afterUpdate: async (updatedTask, client) => {
            await registerTaskOutputDocuments(
              client,
              identity.tenantId,
              updatedTask,
              persisted.output,
            );
            await context.maybeResolveEscalationSource(identity, updatedTask, client);
          },
          reason: 'task_completed',
        }, existingClient);
  } catch (error) {
    if (context.deps.artifactService) {
      for (const artifactId of persisted.cleanupArtifactIds) {
        await context.deps.artifactService
          .deleteTaskArtifact(identity, taskId, artifactId)
          .catch(() => undefined);
      }
    }
    throw error;
  }
}

export async function failTask(
  context: TaskLifecycleServiceOperationContext,
  identity: ApiKeyIdentity,
  taskId: string,
  payload: {
    error: Record<string, unknown>;
    metrics?: Record<string, unknown>;
    git_info?: Record<string, unknown>;
    agent_id?: string;
    worker_id?: string;
  },
  existingClient?: DatabaseClient,
): Promise<Record<string, unknown>> {
  const assignment = identity.scope === 'agent'
    ? context.requireLifecycleIdentity(identity, payload)
    : undefined;
  const task = normalizeTaskRecord(
    await context.deps.loadTaskOrThrow(identity.tenantId, taskId, existingClient),
  );
  const safeError = sanitizeSecretLikeRecord(payload.error);

  if (isFailTaskReplay(task, safeError) || isCancelledOrCompletedTask(task)) {
    return context.deps.toTaskResponse(task);
  }

  const lifecyclePolicy = readPersistedLifecyclePolicy(task.metadata);
  const failure: FailureClassification = classifyFailure(payload.error);
  const retryPlan = buildRetryPlan(task, lifecyclePolicy, failure);

  if (retryPlan.shouldRetry) {
    const nextState = retryPlan.policy ? 'pending' : 'ready';
    return context.applyStateTransition(identity, taskId, nextState, {
      expectedStates: ['in_progress', 'claimed'],
      requireAssignment: assignment,
      retryIncrement: true,
      clearAssignment: true,
      reason: 'auto_retry_scheduled',
      clearExecutionData: true,
      clearLifecycleControlMetadata: true,
      clearEscalationMetadata: true,
      metadataPatch: {
        retry_policy: retryPlan.policy,
        ...(retryPlan.policy
          ? { retry_available_at: retryPlan.retryAvailableAt?.toISOString() ?? null }
          : { retry_available_at: null }),
        retry_backoff_seconds: retryPlan.backoffSeconds,
        last_failure: failure,
        retry_last_error: safeError,
      },
      afterUpdate: async (updatedTask, client) => {
        await context.deps.eventService.emit(
          {
            tenantId: identity.tenantId,
            type: 'task.retry_scheduled',
            entityType: 'task',
            entityId: taskId,
            actorType: identity.scope,
            actorId: identity.keyPrefix,
            data: {
              retry_count: updatedTask.retry_count,
              backoff_seconds: retryPlan.backoffSeconds,
              retry_available_at: retryPlan.retryAvailableAt?.toISOString() ?? null,
              failure,
            },
          },
          client,
        );
        await context.logGovernanceTransition(
          identity.tenantId,
          'task.retry.scheduled',
          updatedTask,
          {
            event_type: 'task.retry_scheduled',
            retry_count: updatedTask.retry_count ?? null,
            backoff_seconds: retryPlan.backoffSeconds,
            retry_available_at: retryPlan.retryAvailableAt?.toISOString() ?? null,
            failure,
          },
          client,
        );
      },
    }, existingClient);
  }

  const safeMetrics = payload.metrics ? sanitizeSecretLikeRecord(payload.metrics) : undefined;
  const safeGitInfo = payload.git_info
    ? sanitizeSecretLikeRecord(payload.git_info)
    : undefined;

  return context.applyStateTransition(identity, taskId, 'failed', {
    expectedStates: ['in_progress', 'claimed'],
    requireAssignment: assignment,
    error: safeError,
    metrics: safeMetrics,
    gitInfo: safeGitInfo,
    clearAssignment: true,
    clearLifecycleControlMetadata: true,
    metadataPatch: {
      last_failure: failure,
    },
    afterUpdate: async (updatedTask, client) => {
      await context.maybeCreateEscalationTask(
        identity,
        updatedTask,
        lifecyclePolicy,
        failure,
        client,
      );
    },
    reason: 'task_failed',
  }, existingClient);
}
