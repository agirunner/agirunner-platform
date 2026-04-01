import type { DatabaseClient } from '../../db/database.js';
import { logSafetynetTriggered } from '../safetynet/logging.js';
import {
  PLATFORM_ACTIVATION_STALE_CALLBACK_SUPPRESSION_ID,
  mustGetSafetynetEntry,
} from '../safetynet/registry.js';

import { ActivationRecoveryStore } from './recovery-store.js';
import { recoverStaleActivation } from './recovery-runner.js';
import { ActivationStateStore } from './activation-state-store.js';
import { ActivationTaskStore } from './task-store.js';
import { dispatchActivation as dispatchActivationRunner } from './dispatch-runner.js';
import {
  buildActivationSummary,
  buildDispatchEligibilityCondition,
  buildHeartbeatRequestId,
  countDispatchableEvents,
  deriveActivationReason,
  derivePrimaryActivationEvent,
  findActivationAnchor,
  isBlockedFailedActivation,
  isActiveActivationConstraintError,
  normalizeFailedActivationError,
  readTaskDispatchAttempt,
  readTaskDispatchToken,
} from './helpers.js';
import {
  ACTIVE_SPECIALIST_HEARTBEAT_SKIP_STATES,
  ACTIVE_ORCHESTRATOR_TASK_STATES,
  BLOCKED_ACTIVATION_RECOVERY_STATUS,
  type ActivationRecoveryResult,
  type ActivationTaskDefinition,
  type ActivationTaskLoopContract,
  type DispatchCandidateRow,
  type DispatchDependencies,
  type DispatchOptions,
  type ExistingActivationTaskResolution,
  type HeartbeatCandidateRow,
  type QueuedActivationRow,
  type RecoveryCandidateRow,
} from './types.js';

export type {
  ActivationRecoveryDetail,
  ActivationRecoveryResult,
} from './types.js';

export class WorkflowActivationDispatchService {
  private readonly activationStateStore: ActivationStateStore;
  private readonly activationTaskStore: ActivationTaskStore;
  private readonly activationRecoveryStore: ActivationRecoveryStore;

  constructor(private readonly deps: DispatchDependencies) {
    this.activationStateStore = new ActivationStateStore(deps);
    this.activationTaskStore = new ActivationTaskStore();
    this.activationRecoveryStore = new ActivationRecoveryStore(deps);
  }

  async enqueueHeartbeatActivations(limit = 20): Promise<number> {
    const timingDefaults = await this.activationStateStore.readActivationTimingDefaults();
    const result = await this.deps.pool.query<HeartbeatCandidateRow>(
      `SELECT w.tenant_id, w.id AS workflow_id
         FROM workflows w
        WHERE w.state IN ('pending', 'active')
          AND NOT EXISTS (
            SELECT 1
              FROM tasks t
             WHERE t.tenant_id = w.tenant_id
               AND t.workflow_id = w.id
               AND t.is_orchestrator_task = true
               AND t.state = ANY($1::task_state[])
          )
          AND NOT EXISTS (
            SELECT 1
              FROM workflow_activations wa
             WHERE wa.tenant_id = w.tenant_id
               AND wa.workflow_id = w.id
               AND wa.consumed_at IS NULL
          )
          AND NOT EXISTS (
            SELECT 1
              FROM tasks t
             WHERE t.tenant_id = w.tenant_id
               AND t.workflow_id = w.id
               AND t.is_orchestrator_task = false
               AND t.state = ANY($3::task_state[])
          )
          AND NOT EXISTS (
            SELECT 1
              FROM workflow_activations wa
             WHERE wa.tenant_id = w.tenant_id
               AND wa.workflow_id = w.id
               AND wa.event_type = 'heartbeat'
               AND COALESCE(wa.completed_at, wa.queued_at) >= now() - ($2 * interval '1 millisecond')
          )
        ORDER BY w.updated_at ASC, w.id ASC
        LIMIT $4`,
      [
        ACTIVE_ORCHESTRATOR_TASK_STATES,
        timingDefaults.heartbeatIntervalMs,
        ACTIVE_SPECIALIST_HEARTBEAT_SKIP_STATES,
        limit,
      ],
    );

    let enqueued = 0;
    for (const row of result.rows) {
      const requestId = buildHeartbeatRequestId(
        row.workflow_id,
        timingDefaults.heartbeatIntervalMs,
      );
      const activation = await this.activationStateStore.insertHeartbeatActivation(
        row.tenant_id,
        row.workflow_id,
        requestId,
      );
      if (activation) {
        enqueued += 1;
      }
    }

    return enqueued;
  }

  async dispatchQueuedActivations(limit = 20): Promise<number> {
    const timingDefaults = await this.activationStateStore.readActivationTimingDefaults();
    const dispatchEligibilityCondition = buildDispatchEligibilityCondition('wa', '$2');
    const result = await this.deps.pool.query<DispatchCandidateRow>(
      `SELECT DISTINCT ON (wa.workflow_id)
              wa.id,
              wa.tenant_id,
              wa.workflow_id
         FROM workflow_activations wa
         JOIN workflows w
           ON w.tenant_id = wa.tenant_id
          AND w.id = wa.workflow_id
        WHERE wa.state = 'queued'
          AND wa.consumed_at IS NULL
          AND wa.activation_id IS NULL
          AND COALESCE(wa.error->'recovery'->>'status', '') <> '${BLOCKED_ACTIVATION_RECOVERY_STATUS}'
          AND w.state IN ('pending', 'active')
          AND (
            ${dispatchEligibilityCondition}
          )
          AND NOT EXISTS (
            SELECT 1
              FROM tasks t
             WHERE t.tenant_id = wa.tenant_id
               AND t.workflow_id = wa.workflow_id
               AND t.is_orchestrator_task = true
               AND t.state = ANY($1::task_state[])
          )
          AND NOT EXISTS (
            SELECT 1
              FROM workflow_activations active
             WHERE active.tenant_id = wa.tenant_id
               AND active.workflow_id = wa.workflow_id
               AND active.state = 'processing'
               AND active.consumed_at IS NULL
               AND active.id = active.activation_id
          )
        ORDER BY wa.workflow_id,
                 CASE WHEN wa.event_type = 'heartbeat' THEN 1 ELSE 0 END ASC,
                 wa.queued_at ASC
        LIMIT $3`,
      [ACTIVE_ORCHESTRATOR_TASK_STATES, timingDefaults.activationDelayMs, limit],
    );

    let dispatched = 0;
    for (const row of result.rows) {
      let taskId: string | null = null;
      try {
        taskId = await this.dispatchActivation(row.tenant_id, row.id);
      } catch (error) {
        if (!isActiveActivationConstraintError(error)) {
          continue;
        }
      }
      if (taskId) {
        dispatched += 1;
      }
    }

    return dispatched;
  }

  async recoverStaleActivations(limit = 20): Promise<ActivationRecoveryResult> {
    const timingDefaults = await this.activationStateStore.readActivationTimingDefaults();
    const result = await this.deps.pool.query<RecoveryCandidateRow>(
      `SELECT wa.id, wa.tenant_id
         FROM workflow_activations wa
         JOIN workflows w
           ON w.tenant_id = wa.tenant_id
          AND w.id = wa.workflow_id
        WHERE wa.state = 'processing'
          AND wa.id = wa.activation_id
          AND wa.consumed_at IS NULL
          AND wa.started_at <= now() - ($1 * interval '1 millisecond')
          AND w.state IN ('pending', 'active')
          AND (
            COALESCE(wa.error->'recovery'->>'status', '') <> 'stale_detected'
            OR NOT EXISTS (
              SELECT 1
                FROM tasks t
               WHERE t.tenant_id = wa.tenant_id
                 AND t.workflow_id = wa.workflow_id
                 AND t.activation_id = wa.id
                 AND t.is_orchestrator_task = true
                 AND t.state = ANY($3::task_state[])
            )
          )
        ORDER BY
          CASE
            WHEN COALESCE(wa.error->'recovery'->>'status', '') = 'stale_detected' THEN 1
            ELSE 0
          END,
          wa.started_at ASC
        LIMIT $2`,
      [timingDefaults.staleAfterMs, limit, ACTIVE_ORCHESTRATOR_TASK_STATES],
    );

    const totals: ActivationRecoveryResult = {
      requeued: 0,
      redispatched: 0,
      reported: 0,
      details: [],
    };
    for (const row of result.rows) {
      let recovery: ActivationRecoveryResult;
      try {
        recovery = await this.recoverStaleActivation(row.tenant_id, row.id);
      } catch {
        continue;
      }
      totals.requeued += recovery.requeued;
      totals.redispatched += recovery.redispatched;
      totals.reported += recovery.reported;
      totals.details.push(...recovery.details);
    }

    return totals;
  }

  async finalizeActivationForTask(
    tenantId: string,
    task: Record<string, unknown>,
    status: 'completed' | 'failed' | 'escalated',
    client: DatabaseClient,
  ): Promise<void> {
    if (!task.is_orchestrator_task || !task.activation_id || !task.workflow_id) {
      return;
    }

    const dispatchAttempt = readTaskDispatchAttempt(task);
    const dispatchToken = readTaskDispatchToken(task);
    const isFinalizable = await this.activationStateStore.lockFinalizableActivation(
      tenantId,
      String(task.workflow_id),
      String(task.activation_id),
      dispatchAttempt,
      dispatchToken,
      client,
    );
    if (!isFinalizable) {
      return;
    }

    const hasReplacementTask = await this.activationStateStore.hasActiveReplacementTask(
      tenantId,
      String(task.workflow_id),
      String(task.activation_id),
      task.id == null ? null : String(task.id),
      client,
    );
    if (hasReplacementTask) {
      logSafetynetTriggered(
        mustGetSafetynetEntry(PLATFORM_ACTIVATION_STALE_CALLBACK_SUPPRESSION_ID),
        'platform suppressed a stale orchestrator activation callback because a replacement orchestrator task is already active',
        {
          tenant_id: tenantId,
          workflow_id: String(task.workflow_id),
          activation_id: String(task.activation_id),
          task_id: task.id == null ? null : String(task.id),
          callback_status: status,
        },
      );
      return;
    }

    const summary = buildActivationSummary(task, status);
    const error = status === 'failed'
      ? normalizeFailedActivationError(task.error)
      : null;
    const blockedFailure = status === 'failed' && isBlockedFailedActivation(error);
    const activationResult = await client.query<QueuedActivationRow>(
      status !== 'failed'
        ? `UPDATE workflow_activations
              SET state = 'completed',
                  consumed_at = now(),
                  completed_at = now(),
                  summary = $4,
                  dispatch_token = NULL,
                  error = CASE
                    WHEN jsonb_typeof(error->'recovery') = 'object'
                      THEN jsonb_build_object('recovery', error->'recovery')
                    ELSE NULL
                  END
            WHERE tenant_id = $1
              AND workflow_id = $2
              AND (id = $3 OR activation_id = $3)
              AND consumed_at IS NULL
          RETURNING id, tenant_id, workflow_id, activation_id, request_id, reason, event_type, payload,
                    state, dispatch_attempt, dispatch_token, queued_at, started_at, consumed_at, completed_at, summary, error`
        : `UPDATE workflow_activations
              SET state = 'queued',
                  activation_id = NULL,
                  started_at = NULL,
                  completed_at = NULL,
                  dispatch_token = NULL,
                  summary = $4,
                  error = $5
            WHERE tenant_id = $1
              AND workflow_id = $2
              AND (id = $3 OR activation_id = $3)
              AND consumed_at IS NULL
          RETURNING id, tenant_id, workflow_id, activation_id, request_id, reason, event_type, payload,
                    state, dispatch_attempt, dispatch_token, queued_at, started_at, consumed_at, completed_at, summary, error`,
      status !== 'failed'
        ? [tenantId, task.workflow_id, task.activation_id, summary]
        : [tenantId, task.workflow_id, task.activation_id, summary, error],
    );
    if (!activationResult.rowCount) {
      return;
    }

    const activation = findActivationAnchor(String(task.activation_id), activationResult.rows);
    const activationReason = deriveActivationReason(activationResult.rows);
    const primaryEvent = derivePrimaryActivationEvent(activation, activationResult.rows);
    await this.deps.eventService.emit(
      {
        tenantId,
        type: status === 'failed' ? 'workflow.activation_failed' : 'workflow.activation_completed',
        entityType: 'workflow',
        entityId: activation.workflow_id,
        actorType: 'system',
        actorId: 'workflow_activation_dispatcher',
        data: {
          activation_id: activation.id,
          event_type: primaryEvent.event_type,
          reason: activationReason,
          task_id: task.id ?? null,
          event_count: countDispatchableEvents(activationResult.rows),
        },
      },
      client,
    );

    if (!blockedFailure) {
      await this.dispatchNextQueuedActivation(tenantId, String(task.workflow_id), client);
    }
  }

  async dispatchActivation(
    tenantId: string,
    activationId: string,
    existingClient?: DatabaseClient,
    options: DispatchOptions = {},
  ): Promise<string | null> {
    return dispatchActivationRunner({
      tenantId,
      activationId,
      deps: this.deps,
      activationStateStore: this.activationStateStore,
      activationTaskStore: this.activationTaskStore,
      resolveExistingActivationTask: this.resolveExistingActivationTask.bind(this),
      existingClient,
      options,
    });
  }

  private async dispatchNextQueuedActivation(
    tenantId: string,
    workflowId: string,
    client: DatabaseClient,
  ): Promise<void> {
    const timingDefaults = await this.activationStateStore.readActivationTimingDefaults(client);
    const dispatchEligibilityCondition = buildDispatchEligibilityCondition('', '$3');
    const nextActivationResult = await client.query<{ id: string }>(
      `SELECT id
         FROM workflow_activations
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND consumed_at IS NULL
          AND activation_id IS NULL
          AND state = 'queued'
          AND (
            ${dispatchEligibilityCondition}
          )
        ORDER BY CASE WHEN event_type = 'heartbeat' THEN 1 ELSE 0 END ASC,
                 queued_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED`,
      [tenantId, workflowId, timingDefaults.activationDelayMs],
    );
    if (!nextActivationResult.rowCount) {
      return;
    }

    await this.dispatchActivation(tenantId, nextActivationResult.rows[0].id, client, {
      ignoreDelay: true,
    });
  }

  private async resolveExistingActivationTask(
    tenantId: string,
    workflowId: string,
    activationId: string,
    requestId: string,
    taskDefinition: ActivationTaskDefinition,
    loopContract: ActivationTaskLoopContract,
    client: DatabaseClient,
  ): Promise<ExistingActivationTaskResolution | null> {
    return this.activationTaskStore.resolveExistingActivationTask(
      tenantId,
      workflowId,
      activationId,
      requestId,
      taskDefinition,
      loopContract,
      client,
      this.finalizeActivationForTask.bind(this),
    );
  }

  private async reactivateExistingActivationTask(
    tenantId: string,
    taskId: string,
    activationId: string,
    taskDefinition: ActivationTaskDefinition,
    loopContract: ActivationTaskLoopContract,
    client: DatabaseClient,
  ): Promise<void> {
    return this.activationTaskStore.reactivateExistingActivationTask(
      tenantId,
      taskId,
      activationId,
      taskDefinition,
      loopContract,
      client,
    );
  }

  private async recoverStaleActivation(
    tenantId: string,
    activationId: string,
  ): Promise<ActivationRecoveryResult> {
    return recoverStaleActivation({
      tenantId,
      activationId,
      deps: this.deps,
      activationStateStore: this.activationStateStore,
      activationRecoveryStore: this.activationRecoveryStore,
      dispatchActivation: this.dispatchActivation.bind(this),
    });
  }
}
