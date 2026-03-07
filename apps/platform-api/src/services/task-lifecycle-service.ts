import type { ApiKeyIdentity } from '../auth/api-key.js';
import { validateOutputSchema } from '../built-in/output-validator.js';
import type { DatabaseClient, DatabasePool } from '../db/database.js';
import { ConflictError, ForbiddenError } from '../errors/domain-errors.js';
import { assertValidTransition, type TaskState } from '../orchestration/task-state-machine.js';
import type { ArtifactService } from './artifact-service.js';
import { applyTaskCompletionSideEffects } from './task-completion-side-effects.js';
import { registerTaskOutputDocuments } from './document-reference-service.js';
import { EventService } from './event-service.js';
import { PipelineStateService } from './pipeline-state-service.js';
import { applyOutputStateDeclarations } from './task-output-storage.js';

interface TransitionOptions {
  expectedStates: TaskState[];
  requireAssignment?: { agentId?: string; workerId?: string };
  output?: unknown;
  error?: unknown;
  metrics?: Record<string, unknown>;
  gitInfo?: Record<string, unknown>;
  verification?: Record<string, unknown>;
  reason?: string;
  retryIncrement?: boolean;
  clearAssignment?: boolean;
  clearExecutionData?: boolean;
  clearLifecycleControlMetadata?: boolean;
  startedAt?: Date;
  overrideInput?: Record<string, unknown>;
  metadataPatch?: Record<string, unknown>;
  afterUpdate?: (
    updatedTask: Record<string, unknown>,
    client: DatabaseClient,
  ) => Promise<void>;
}

interface TaskLifecycleDependencies {
  pool: DatabasePool;
  eventService: EventService;
  pipelineStateService: PipelineStateService;
  loadTaskOrThrow: (
    tenantId: string,
    taskId: string,
    client?: DatabaseClient,
  ) => Promise<Record<string, unknown>>;
  toTaskResponse: (task: Record<string, unknown>) => Record<string, unknown>;
  artifactService?: Pick<ArtifactService, 'uploadTaskArtifact' | 'deleteTaskArtifact'>;
  queueWorkerCancelSignal?: (
    identity: ApiKeyIdentity,
    workerId: string,
    taskId: string,
    reason: 'manual_cancel' | 'task_timeout',
    requestedAt: Date,
  ) => Promise<string | null>;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export class TaskLifecycleService {
  constructor(private readonly deps: TaskLifecycleDependencies) {}

  private requireLifecycleIdentity(
    identity: ApiKeyIdentity,
    payload: { agent_id?: string; worker_id?: string } = {},
  ): { agentId?: string; workerId?: string } {
    if (identity.scope === 'agent') {
      if (!identity.ownerId) {
        throw new ForbiddenError('Agent identity is required for task lifecycle operations');
      }
      if (payload.agent_id && payload.agent_id !== identity.ownerId) {
        throw new ForbiddenError('Task lifecycle operation can only target the calling agent');
      }
      return {
        agentId: identity.ownerId,
        workerId: payload.worker_id,
      };
    }

    if (identity.scope === 'worker') {
      if (!identity.ownerId) {
        throw new ForbiddenError('Worker identity is required for task lifecycle operations');
      }
      if (payload.worker_id && payload.worker_id !== identity.ownerId) {
        throw new ForbiddenError('Task lifecycle operation can only target the calling worker');
      }
      return {
        agentId: payload.agent_id,
        workerId: identity.ownerId,
      };
    }

    throw new ForbiddenError('Agent or worker identity is required for task lifecycle operations');
  }

  private extractOutputSchema(task: Record<string, unknown>): Record<string, unknown> | undefined {
    const explicitOutputSchema = task.output_schema;
    if (
      explicitOutputSchema &&
      typeof explicitOutputSchema === 'object' &&
      !Array.isArray(explicitOutputSchema)
    ) {
      return explicitOutputSchema as Record<string, unknown>;
    }

    const roleConfig = asRecord(task.role_config);
    const schema = roleConfig.output_schema;
    if (schema && typeof schema === 'object' && !Array.isArray(schema)) {
      return schema as Record<string, unknown>;
    }

    return undefined;
  }

  private readVerificationPassed(
    verification: Record<string, unknown> | undefined,
    metrics: Record<string, unknown> | undefined,
  ): boolean | undefined {
    if (typeof verification?.passed === 'boolean') {
      return verification.passed;
    }
    if (typeof metrics?.verification_passed === 'boolean') {
      return metrics.verification_passed as boolean;
    }
    return undefined;
  }

  async applyStateTransition(
    identity: ApiKeyIdentity,
    taskId: string,
    nextState: TaskState,
    options: TransitionOptions,
  ) {
    const client = await this.deps.pool.connect();
    try {
      await client.query('BEGIN');
      const task = await this.deps.loadTaskOrThrow(identity.tenantId, taskId, client);

      if (!options.expectedStates.includes(task.state as TaskState)) {
        assertValidTransition(task.id as string, task.state as TaskState, nextState);
      }

      if (
        options.requireAssignment?.agentId &&
        task.assigned_agent_id !== options.requireAssignment.agentId
      ) {
        throw new ForbiddenError('Task is assigned to a different agent');
      }
      if (
        options.requireAssignment?.workerId &&
        task.assigned_worker_id !== options.requireAssignment.workerId
      ) {
        throw new ConflictError('Task is assigned to a different worker');
      }

      const updateFragments: string[] = ['state = $3', 'state_changed_at = now()'];
      const values: unknown[] = [identity.tenantId, taskId, nextState];

      if (nextState === 'running') {
        if (options.startedAt) {
          values.push(options.startedAt);
          updateFragments.push(`started_at = $${values.length}`);
        } else {
          updateFragments.push('started_at = now()');
        }
      }

      if (nextState === 'completed') {
        updateFragments.push('completed_at = now()', 'error = NULL');
      }

      if (options.output !== undefined) {
        values.push(options.output);
        updateFragments.push(`output = $${values.length}`);
      }

      if (options.overrideInput !== undefined) {
        values.push(options.overrideInput);
        updateFragments.push(`input = $${values.length}`);
      }

      if (nextState === 'failed') {
        values.push(
          options.error ?? {
            category: 'unknown',
            message: options.reason ?? 'failed',
            recoverable: false,
          },
        );
        updateFragments.push(`error = $${values.length}`);
      }

      if (options.metrics !== undefined) {
        values.push(options.metrics);
        updateFragments.push(`metrics = $${values.length}`);
      }

      if (options.gitInfo !== undefined) {
        values.push(options.gitInfo);
        updateFragments.push(`git_info = $${values.length}`);
      }

      const metadataPatch =
        options.verification !== undefined || options.metadataPatch !== undefined
          ? {
              ...(options.verification !== undefined ? { verification: options.verification } : {}),
              ...(options.metadataPatch ?? {}),
            }
          : undefined;

      let metadataExpression = 'metadata';
      if (options.clearLifecycleControlMetadata) {
        metadataExpression =
          "(metadata - 'cancel_signal_requested_at' - 'cancel_force_fail_at' - 'cancel_signal_id' - 'cancel_reason' - 'timeout_cancel_requested_at' - 'timeout_force_fail_at' - 'timeout_signal_id')";
      }
      if (metadataPatch) {
        values.push(metadataPatch);
        metadataExpression = `${metadataExpression} || $${values.length}::jsonb`;
      }
      if (metadataExpression !== 'metadata') {
        updateFragments.push(`metadata = ${metadataExpression}`);
      }

      if (options.retryIncrement) updateFragments.push('retry_count = retry_count + 1');
      if (options.clearAssignment)
        updateFragments.push(
          'assigned_agent_id = NULL',
          'assigned_worker_id = NULL',
          'claimed_at = NULL',
          'started_at = NULL',
        );
      if (options.clearExecutionData)
        updateFragments.push('output = NULL', 'error = NULL', 'metrics = NULL', 'git_info = NULL');

      const expectedStateParam = `$${values.length + 1}`;
      values.push(options.expectedStates);

      const updateSql = `UPDATE tasks SET ${updateFragments.join(', ')} WHERE tenant_id = $1 AND id = $2 AND state = ANY(${expectedStateParam}::task_state[]) RETURNING *`;
      const updatedResult = await client.query(updateSql, values);
      if (!updatedResult.rowCount) {
        const latestTask = await this.deps.loadTaskOrThrow(identity.tenantId, taskId, client);
        if (!options.expectedStates.includes(latestTask.state as TaskState)) {
          assertValidTransition(task.id as string, latestTask.state as TaskState, nextState);
        }
        throw new ConflictError('Task state changed concurrently');
      }

      const updatedTask = updatedResult.rows[0] as Record<string, unknown>;

      if (options.clearAssignment && task.assigned_agent_id) {
        await client.query(
          `UPDATE agents
           SET current_task_id = NULL,
               status = (CASE WHEN status = 'inactive' THEN 'inactive' ELSE 'idle' END)::agent_status
           WHERE tenant_id = $1 AND id = $2`,
          [identity.tenantId, task.assigned_agent_id],
        );
      }

      await this.deps.eventService.emit(
        {
          tenantId: identity.tenantId,
          type: 'task.state_changed',
          entityType: 'task',
          entityId: taskId,
          actorType: identity.scope,
          actorId: identity.keyPrefix,
          data: { from_state: task.state, to_state: nextState, reason: options.reason },
        },
        client,
      );

      if (nextState === 'completed') {
        await applyTaskCompletionSideEffects(this.deps.eventService, identity, updatedTask, client);
      }
      if (options.afterUpdate) {
        await options.afterUpdate(updatedTask, client);
      }

      if (task.pipeline_id) {
        await this.deps.pipelineStateService.recomputePipelineState(
          identity.tenantId,
          task.pipeline_id as string,
          client,
          {
            actorType: 'system',
            actorId: 'task_state_transition',
          },
        );
      }

      await client.query('COMMIT');
      return this.deps.toTaskResponse(updatedTask);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async startTask(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: { agent_id?: string; worker_id?: string; started_at?: string },
  ) {
    const assignment = this.requireLifecycleIdentity(identity, payload);
    const startedAt = payload.started_at ? new Date(payload.started_at) : undefined;

    return this.applyStateTransition(identity, taskId, 'running', {
      expectedStates: ['claimed'],
      requireAssignment: assignment,
      reason: 'task_started',
      startedAt: startedAt && Number.isFinite(startedAt.getTime()) ? startedAt : undefined,
    });
  }

  async completeTask(
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
  ) {
    const assignment = this.requireLifecycleIdentity(identity, payload);
    const task = await this.deps.loadTaskOrThrow(identity.tenantId, taskId);
    const outputValidation = validateOutputSchema(payload.output, this.extractOutputSchema(task));
    const verificationPassed = this.readVerificationPassed(payload.verification, payload.metrics);
    const persisted = this.deps.artifactService
      ? await applyOutputStateDeclarations(
          this.deps.artifactService,
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

    const shouldMoveToOutputReview = !outputValidation.valid || verificationPassed === false;

    try {
      return shouldMoveToOutputReview
        ? await this.applyStateTransition(identity, taskId, 'output_pending_review', {
            expectedStates: ['running'],
            requireAssignment: assignment,
            output: persisted.output,
            metrics: payload.metrics,
            gitInfo: persisted.gitInfo,
            verification: payload.verification,
            clearAssignment: true,
            clearLifecycleControlMetadata: true,
            reason: !outputValidation.valid
              ? 'output_schema_review_required'
              : 'verification_review_required',
          })
        : await this.applyStateTransition(identity, taskId, 'completed', {
            expectedStates: ['running'],
            requireAssignment: assignment,
            output: persisted.output,
            metrics: payload.metrics,
            gitInfo: persisted.gitInfo,
            verification: payload.verification,
            clearAssignment: true,
            clearLifecycleControlMetadata: true,
            afterUpdate: async (updatedTask, client) => {
              await registerTaskOutputDocuments(client, identity.tenantId, updatedTask, persisted.output);
            },
            reason: 'task_completed',
          });
    } catch (error) {
      if (this.deps.artifactService) {
        for (const artifactId of persisted.cleanupArtifactIds) {
          await this.deps.artifactService
            .deleteTaskArtifact(identity, taskId, artifactId)
            .catch(() => undefined);
        }
      }
      throw error;
    }
  }

  async failTask(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: {
      error: Record<string, unknown>;
      metrics?: Record<string, unknown>;
      git_info?: Record<string, unknown>;
      agent_id?: string;
      worker_id?: string;
    },
  ) {
    const assignment = this.requireLifecycleIdentity(identity, payload);
    const task = await this.deps.loadTaskOrThrow(identity.tenantId, taskId);
    const shouldRetry =
      Boolean(task.auto_retry) && Number(task.retry_count) < Number(task.max_retries);

    return shouldRetry
      ? this.applyStateTransition(identity, taskId, 'ready', {
          expectedStates: ['running', 'claimed'],
          requireAssignment: assignment,
          retryIncrement: true,
          clearAssignment: true,
          reason: 'auto_retry',
          clearExecutionData: true,
          clearLifecycleControlMetadata: true,
        })
      : this.applyStateTransition(identity, taskId, 'failed', {
          expectedStates: ['running', 'claimed'],
          requireAssignment: assignment,
          error: payload.error,
          metrics: payload.metrics,
          gitInfo: payload.git_info,
          clearAssignment: true,
          clearLifecycleControlMetadata: true,
          reason: 'task_failed',
        });
  }

  async approveTask(identity: ApiKeyIdentity, taskId: string) {
    return this.applyStateTransition(identity, taskId, 'ready', {
      expectedStates: ['awaiting_approval'],
      reason: 'approved',
    });
  }

  async retryTask(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: { override_input?: Record<string, unknown>; force?: boolean } = {},
  ) {
    const task = await this.deps.loadTaskOrThrow(identity.tenantId, taskId);
    const expectedStates: TaskState[] = payload.force
      ? [
          'failed',
          'cancelled',
          'completed',
          'ready',
          'pending',
          'awaiting_approval',
          'output_pending_review',
        ]
      : ['failed'];

    if (!expectedStates.includes(task.state as TaskState)) {
      throw new ConflictError('Task is not retryable');
    }

    return this.applyStateTransition(identity, taskId, 'ready', {
      expectedStates,
      retryIncrement: true,
      clearAssignment: true,
      clearExecutionData: true,
      clearLifecycleControlMetadata: true,
      overrideInput: payload.override_input,
      reason: payload.force ? 'manual_retry_forced' : 'manual_retry',
    });
  }

  async cancelTask(identity: ApiKeyIdentity, taskId: string) {
    const task = await this.deps.loadTaskOrThrow(identity.tenantId, taskId);
    if (task.state === 'completed') throw new ConflictError('Completed task cannot be cancelled');

    if (
      (task.state === 'claimed' || task.state === 'running') &&
      typeof task.assigned_worker_id === 'string' &&
      this.deps.queueWorkerCancelSignal
    ) {
      await this.deps.queueWorkerCancelSignal(
        identity,
        task.assigned_worker_id,
        taskId,
        'manual_cancel',
        new Date(),
      );
    }

    return this.applyStateTransition(identity, taskId, 'cancelled', {
      expectedStates: [
        'pending',
        'ready',
        'claimed',
        'running',
        'awaiting_approval',
        'output_pending_review',
        'failed',
      ],
      clearAssignment: true,
      clearLifecycleControlMetadata: true,
      reason: 'cancelled',
    });
  }

  async rejectTask(identity: ApiKeyIdentity, taskId: string, payload: { feedback: string }) {
    return this.applyStateTransition(identity, taskId, 'failed', {
      expectedStates: ['awaiting_approval', 'output_pending_review', 'running', 'claimed'],
      clearAssignment: true,
      clearLifecycleControlMetadata: true,
      error: {
        category: 'review_rejected',
        message: payload.feedback,
        recoverable: true,
      },
      metadataPatch: {
        review_feedback: payload.feedback,
        review_action: 'reject',
        review_updated_at: new Date().toISOString(),
      },
      reason: 'review_rejected',
    });
  }

  async requestTaskChanges(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: {
      feedback: string;
      override_input?: Record<string, unknown>;
      preferred_agent_id?: string;
      preferred_worker_id?: string;
    },
  ) {
    const task = await this.deps.loadTaskOrThrow(identity.tenantId, taskId);
    const nextInput = payload.override_input ?? {
      ...asRecord(task.input),
      review_feedback: payload.feedback,
    };

    return this.applyStateTransition(identity, taskId, 'ready', {
      expectedStates: [
        'awaiting_approval',
        'output_pending_review',
        'completed',
        'failed',
        'cancelled',
      ],
      clearAssignment: true,
      clearExecutionData: true,
      clearLifecycleControlMetadata: true,
      retryIncrement: true,
      overrideInput: nextInput,
      metadataPatch: {
        review_feedback: payload.feedback,
        review_action: 'request_changes',
        review_updated_at: new Date().toISOString(),
        ...(payload.preferred_agent_id ? { preferred_agent_id: payload.preferred_agent_id } : {}),
        ...(payload.preferred_worker_id
          ? { preferred_worker_id: payload.preferred_worker_id }
          : {}),
      },
      reason: 'review_requested_changes',
    });
  }

  async skipTask(identity: ApiKeyIdentity, taskId: string, payload: { reason: string }) {
    return this.applyStateTransition(identity, taskId, 'completed', {
      expectedStates: [
        'pending',
        'ready',
        'awaiting_approval',
        'output_pending_review',
        'failed',
        'cancelled',
      ],
      clearAssignment: true,
      clearLifecycleControlMetadata: true,
      output: {
        skipped: true,
        reason: payload.reason,
      },
      metadataPatch: {
        review_action: 'skip',
        review_feedback: payload.reason,
        review_updated_at: new Date().toISOString(),
      },
      reason: 'task_skipped',
    });
  }

  async reassignTask(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: { preferred_agent_id?: string; preferred_worker_id?: string; reason: string },
  ) {
    const task = await this.deps.loadTaskOrThrow(identity.tenantId, taskId);
    if (
      (task.state === 'claimed' || task.state === 'running') &&
      typeof task.assigned_worker_id === 'string' &&
      this.deps.queueWorkerCancelSignal
    ) {
      await this.deps.queueWorkerCancelSignal(
        identity,
        task.assigned_worker_id,
        taskId,
        'manual_cancel',
        new Date(),
      );
    }

    return this.applyStateTransition(identity, taskId, 'ready', {
      expectedStates: [
        'pending',
        'ready',
        'claimed',
        'running',
        'awaiting_approval',
        'output_pending_review',
        'failed',
        'cancelled',
      ],
      clearAssignment: true,
      clearExecutionData: task.state === 'output_pending_review' || task.state === 'failed',
      clearLifecycleControlMetadata: true,
      metadataPatch: {
        preferred_agent_id: payload.preferred_agent_id ?? null,
        preferred_worker_id: payload.preferred_worker_id ?? null,
        review_action: 'reassign',
        review_feedback: payload.reason,
        review_updated_at: new Date().toISOString(),
      },
      reason: 'task_reassigned',
    });
  }

  async escalateTask(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: { reason: string; escalation_target?: string },
  ) {
    const task = await this.deps.loadTaskOrThrow(identity.tenantId, taskId);
    const existingEscalations = Array.isArray(asRecord(task.metadata).escalations)
      ? (asRecord(task.metadata).escalations as unknown[])
      : [];

    return this.applyStateTransition(identity, taskId, task.state as TaskState, {
      expectedStates: [task.state as TaskState],
      metadataPatch: {
        escalations: [
          ...existingEscalations,
          {
            reason: payload.reason,
            target: payload.escalation_target ?? null,
            escalated_at: new Date().toISOString(),
          },
        ],
        review_action: 'escalate',
        review_feedback: payload.reason,
        review_updated_at: new Date().toISOString(),
      },
      reason: 'task_escalated',
    });
  }

  async overrideTaskOutput(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: { output: unknown; reason: string },
  ) {
    return this.applyStateTransition(identity, taskId, 'completed', {
      expectedStates: ['output_pending_review', 'failed', 'cancelled', 'completed'],
      clearAssignment: true,
      clearLifecycleControlMetadata: true,
      output: payload.output,
      metadataPatch: {
        review_action: 'override_output',
        review_feedback: payload.reason,
        review_updated_at: new Date().toISOString(),
      },
      reason: 'task_output_overridden',
    });
  }
}
