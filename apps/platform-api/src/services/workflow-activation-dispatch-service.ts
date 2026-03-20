import { randomUUID } from 'node:crypto';

import type { DatabaseClient, DatabasePool } from '../db/database.js';
import { DEFAULT_TENANT_ID } from '../db/seed.js';

import type { AppEnv } from '../config/schema.js';
import { EventService } from './event-service.js';
import { readWorkflowActivationTimingDefaults } from './platform-timing-defaults.js';
import { buildGitRemoteResourceBindings, resolveWorkspaceStorageBinding } from './workspace-storage.js';
import { loadWorkflowStageProjection } from './workflow-stage-projection.js';
import {
  readRequiredPositiveIntegerRuntimeDefault,
  readPositiveInteger,
  TASK_LLM_MAX_RETRIES_RUNTIME_KEY,
  TASK_DEFAULT_TIMEOUT_MINUTES_RUNTIME_KEY,
  TASK_MAX_ITERATIONS_RUNTIME_KEY,
} from './runtime-default-values.js';

const ACTIVE_ORCHESTRATOR_TASK_STATES = [
  'pending',
  'ready',
  'claimed',
  'in_progress',
  'awaiting_approval',
  'output_pending_review',
] as const;
const ACTIVE_SPECIALIST_HEARTBEAT_SKIP_STATES = [
  'claimed',
  'in_progress',
  'awaiting_approval',
  'output_pending_review',
] as const;
const IMMEDIATE_QUEUE_DISPATCH_EVENT_TYPES = [
  'workflow.created',
  'work_item.created',
  'task.escalated',
  'task.agent_escalated',
  'task.escalation_resolved',
  'task.completed',
  'task.failed',
  'task.output_pending_review',
  'task.approved',
  'task.review_requested_changes',
  'task.handoff_submitted',
  'child_workflow.completed',
  'child_workflow.failed',
  'child_workflow.cancelled',
] as const;
const ACTIVATION_TASK_REQUEST_ID_PATTERN = /^activation:([^:]+):dispatch:(\d+)$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_REPOSITORY_TASK_TEMPLATE = 'execution-workspace';

interface QueuedActivationRow {
  id: string;
  tenant_id: string;
  workflow_id: string;
  activation_id: string | null;
  request_id: string | null;
  reason: string;
  event_type: string;
  payload: Record<string, unknown>;
  state: string;
  dispatch_attempt: number;
  dispatch_token: string | null;
  queued_at: Date;
  started_at: Date | null;
  consumed_at: Date | null;
  completed_at: Date | null;
  summary: string | null;
  error: Record<string, unknown> | null;
}

interface WorkflowDispatchRowBase {
  id: string;
  name: string;
  workspace_id: string | null;
  active_stages: string[];
  playbook_id: string;
  playbook_name: string;
  playbook_outcome: string | null;
  playbook_definition: Record<string, unknown> | null;
  workspace_repository_url: string | null;
  workspace_settings: Record<string, unknown> | null;
  workflow_git_branch: string | null;
  workflow_parameters: Record<string, unknown> | null;
}

interface WorkflowDispatchSourceRow {
  id: string;
  name: string;
  workspace_id: string | null;
  lifecycle: string | null;
  playbook_id: string;
  playbook_name: string;
  playbook_outcome: string | null;
  playbook_definition: Record<string, unknown> | null;
  workspace_repository_url: string | null;
  workspace_settings: Record<string, unknown> | null;
  workflow_git_branch: string | null;
  workflow_parameters: Record<string, unknown> | null;
}

type WorkflowDispatchRow =
  | (WorkflowDispatchRowBase & {
      lifecycle: 'ongoing';
      current_stage?: never;
    })
  | (WorkflowDispatchRowBase & {
      lifecycle?: string | null;
      current_stage: string | null;
    });

interface ActivationTaskRow {
  id: string;
}

interface ExistingActivationTaskRow extends ActivationTaskRow {
  state: string;
  workflow_id: string;
  activation_id: string | null;
  is_orchestrator_task: boolean;
  title: string;
  metadata: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
}

interface ActivationTaskDefinition {
  title: string;
  stageName: string | null;
  input: Record<string, unknown>;
  roleConfig: Record<string, unknown>;
  environment: Record<string, unknown>;
  resourceBindings: Record<string, unknown>[];
  metadata: Record<string, unknown>;
}

interface ActivationTaskLoopContract {
  maxIterations: number;
  llmMaxRetries: number;
}

interface ExistingActivationTaskResolution {
  kind: 'active' | 'reactivated' | 'finalized';
  taskId: string;
  previousState?: string;
}

interface DispatchCandidateRow {
  id: string;
  tenant_id: string;
  workflow_id: string;
}

interface HeartbeatCandidateRow {
  tenant_id: string;
  workflow_id: string;
}

interface RecoveryCandidateRow {
  id: string;
  tenant_id: string;
}

interface StaleActivationStateRow extends QueuedActivationRow {
  active_task_id: string | null;
}

interface DispatchOptions {
  ignoreDelay?: boolean;
}

export interface ActivationRecoveryResult {
  requeued: number;
  redispatched: number;
  reported: number;
  details: ActivationRecoveryDetail[];
}

export interface ActivationRecoveryDetail {
  activation_id: string;
  workflow_id: string;
  status: 'stale_detected' | 'requeued' | 'redispatched';
  reason: 'orchestrator_task_still_active' | 'missing_orchestrator_task';
  stale_started_at: string | null;
  detected_at: string;
  task_id?: string | null;
  redispatched_task_id?: string | null;
}

interface DispatchDependencies {
  pool: DatabasePool;
  eventService: EventService;
  config: {
    TASK_DEFAULT_TIMEOUT_MINUTES?: number;
  } & Partial<
      Pick<
        AppEnv,
        | 'WORKFLOW_ACTIVATION_DELAY_MS'
        | 'WORKFLOW_ACTIVATION_HEARTBEAT_INTERVAL_MS'
        | 'WORKFLOW_ACTIVATION_STALE_AFTER_MS'
      >
    >;
}

export class WorkflowActivationDispatchService {
  constructor(private readonly deps: DispatchDependencies) {}

  async enqueueHeartbeatActivations(limit = 20): Promise<number> {
    const timingDefaults = await this.readActivationTimingDefaults();
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
      const activation = await this.insertHeartbeatActivation(row.tenant_id, row.workflow_id, requestId);
      if (activation) {
        enqueued += 1;
      }
    }

    return enqueued;
  }

  async dispatchQueuedActivations(limit = 20): Promise<number> {
    const timingDefaults = await this.readActivationTimingDefaults();
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
    const timingDefaults = await this.readActivationTimingDefaults();
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
    status: 'completed' | 'failed',
    client: DatabaseClient,
  ): Promise<void> {
    if (!task.is_orchestrator_task || !task.activation_id || !task.workflow_id) {
      return;
    }

    const dispatchAttempt = readTaskDispatchAttempt(task);
    const dispatchToken = readTaskDispatchToken(task);
    const isFinalizable = await this.lockFinalizableActivation(
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

    const hasReplacementTask = await this.hasActiveReplacementTask(
      tenantId,
      String(task.workflow_id),
      String(task.activation_id),
      task.id == null ? null : String(task.id),
      client,
    );
    if (hasReplacementTask) {
      return;
    }

    const summary = buildActivationSummary(task, status);
    const error = status === 'failed' ? task.error ?? { message: 'Orchestrator activation failed' } : null;
    const activationResult = await client.query<QueuedActivationRow>(
      status === 'completed'
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
      status === 'completed'
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
        type: status === 'completed' ? 'workflow.activation_completed' : 'workflow.activation_failed',
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

    await this.dispatchNextQueuedActivation(tenantId, String(task.workflow_id), client);
  }

  async dispatchActivation(
    tenantId: string,
    activationId: string,
    existingClient?: DatabaseClient,
    options: DispatchOptions = {},
  ): Promise<string | null> {
    const client = existingClient ?? (await this.deps.pool.connect());
    const ownsClient = existingClient === undefined;

    try {
      if (ownsClient) {
        await client.query('BEGIN');
      }

      const activation = await this.lockQueuedActivation(tenantId, activationId, client);
      if (!activation) {
        if (ownsClient) {
          await client.query('COMMIT');
        }
        return null;
      }

      const hasActiveTask = await this.hasActiveOrchestratorTask(
        activation.tenant_id,
        activation.workflow_id,
        client,
      );
      if (hasActiveTask) {
        if (ownsClient) {
          await client.query('COMMIT');
        }
        return null;
      }

      const hasProcessingActivation = await this.hasProcessingActivation(
        activation.tenant_id,
        activation.workflow_id,
        activation.id,
        client,
      );
      if (hasProcessingActivation) {
        if (ownsClient) {
          await client.query('COMMIT');
        }
        return null;
      }

      const timingDefaults = await this.readActivationTimingDefaults();
      if (!options.ignoreDelay && !isReadyForDispatch(activation, timingDefaults.activationDelayMs)) {
        if (ownsClient) {
          await client.query('COMMIT');
        }
        return null;
      }

      const workflow = await this.loadWorkflowForDispatch(
        activation.tenant_id,
        activation.workflow_id,
        client,
      );
      if (!workflow) {
        if (ownsClient) {
          await client.query('COMMIT');
        }
        return null;
      }
      const activationBatch = await this.claimActivationBatch(activation, timingDefaults.activationDelayMs, client);
      if (activationBatch.length === 0) {
        if (ownsClient) {
          await client.query('COMMIT');
        }
        return null;
      }
      const activationAnchor = findActivationAnchor(activation.id, activationBatch);
      const activationReason = deriveActivationReason(activationBatch);
      const primaryEvent = derivePrimaryActivationEvent(activationAnchor, activationBatch);
      if (
        activationReason === 'heartbeat' &&
        await this.hasActiveSpecialistTask(activationAnchor.tenant_id, activationAnchor.workflow_id, client)
      ) {
        await this.completeHeartbeatWithoutDispatch(activationAnchor, client);
        if (ownsClient) {
          await client.query('COMMIT');
        }
        return null;
      }
      const taskRequestId = buildActivationTaskRequestId(activationAnchor);
      const taskDefinition = buildActivationTaskDefinition(workflow, activationAnchor, activationBatch);
      const timeoutMinutes = await this.resolveDefaultTaskTimeoutMinutes(
        activationAnchor.tenant_id,
        client,
      );
      const loopContract = await this.resolveActivationTaskLoopContract(
        activationAnchor.tenant_id,
        workflow,
        client,
      );
      const taskResult = await client.query<ActivationTaskRow>(
        `INSERT INTO tasks (
           tenant_id,
           workflow_id,
           workspace_id,
           title,
           role,
           stage_name,
           priority,
           state,
           depends_on,
           requires_approval,
           requires_output_review,
           input,
           context,
           role_config,
           environment,
           resource_bindings,
           activation_id,
           request_id,
           is_orchestrator_task,
           timeout_minutes,
           token_budget,
           cost_cap_usd,
           auto_retry,
           max_retries,
           max_iterations,
           llm_max_retries,
           metadata
         ) VALUES (
           $1, $2, $3, $4, $5, $6, 'high', 'ready', '{}'::uuid[], false, false,
           $7, '{}'::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12, true, $13, NULL, NULL, false, 0, $14, $15, $16::jsonb
         )
         ON CONFLICT (tenant_id, workflow_id, request_id)
         WHERE request_id IS NOT NULL
           AND workflow_id IS NOT NULL
         DO NOTHING
         RETURNING id`,
        [
          activationAnchor.tenant_id,
          activationAnchor.workflow_id,
          workflow.workspace_id,
          taskDefinition.title,
          'orchestrator',
          taskDefinition.stageName,
          taskDefinition.input,
          taskDefinition.roleConfig,
          taskDefinition.environment,
          JSON.stringify(taskDefinition.resourceBindings),
          activationAnchor.id,
          taskRequestId,
          timeoutMinutes,
          loopContract.maxIterations,
          loopContract.llmMaxRetries,
          taskDefinition.metadata,
        ],
      );
      const createdTask = taskResult.rows[0] ?? null;
      const existingTask = createdTask
        ? null
        : await this.resolveExistingActivationTask(
          activationAnchor.tenant_id,
          activationAnchor.workflow_id,
          activationAnchor.id,
          taskRequestId,
          taskDefinition,
          loopContract,
          client,
        );
      const taskId = createdTask?.id ?? existingTask?.taskId ?? null;
      if (!taskId || !createdTask && !existingTask) {
        throw new Error('Failed to create orchestrator task');
      }

      if (existingTask?.kind === 'active' || existingTask?.kind === 'finalized') {
        if (ownsClient) {
          await client.query('COMMIT');
        }
        return taskId;
      }

      if (createdTask == null) {
        await this.deps.eventService.emit(
          {
            tenantId: activationAnchor.tenant_id,
            type: 'task.state_changed',
            entityType: 'task',
            entityId: taskId,
            actorType: 'system',
            actorId: 'workflow_activation_dispatcher',
            data: {
              previous_state: existingTask?.previousState ?? null,
              state: 'ready',
              reason: 'activation_redispatched',
              activation_id: activationAnchor.id,
              is_orchestrator_task: true,
            },
          },
          client,
        );
      } else {
        await this.deps.eventService.emit(
          {
            tenantId: activationAnchor.tenant_id,
            type: 'task.created',
            entityType: 'task',
            entityId: taskId,
            actorType: 'system',
            actorId: 'workflow_activation_dispatcher',
            data: {
              workflow_id: activationAnchor.workflow_id,
              role: 'orchestrator',
              state: 'ready',
              activation_id: activationAnchor.id,
              is_orchestrator_task: true,
            },
          },
          client,
        );
      }

      await this.deps.eventService.emit(
        {
          tenantId: activationAnchor.tenant_id,
          type: 'workflow.activation_started',
          entityType: 'workflow',
          entityId: activationAnchor.workflow_id,
          actorType: 'system',
          actorId: 'workflow_activation_dispatcher',
          data: {
            activation_id: activationAnchor.id,
            event_type: primaryEvent.event_type,
            reason: activationReason,
            task_id: taskId,
            event_count: countDispatchableEvents(activationBatch),
          },
        },
        client,
      );

      if (ownsClient) {
        await client.query('COMMIT');
      }
      return taskId;
    } catch (error) {
      if (ownsClient) {
        await client.query('ROLLBACK');
      }
      if (isActiveActivationConstraintError(error)) {
        return null;
      }
      throw error;
    } finally {
      if (ownsClient) {
        client.release();
      }
    }
  }

  private async dispatchNextQueuedActivation(
    tenantId: string,
    workflowId: string,
    client: DatabaseClient,
  ): Promise<void> {
    const timingDefaults = await this.readActivationTimingDefaults();
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

  private async lockFinalizableActivation(
    tenantId: string,
    workflowId: string,
    activationId: string,
    dispatchAttempt: number | null,
    dispatchToken: string | null,
    client: DatabaseClient,
  ): Promise<boolean> {
    const dispatchAttemptClause = dispatchAttempt === null ? 'AND dispatch_attempt >= 1' : 'AND dispatch_attempt = $4';
    const dispatchTokenClause =
      dispatchToken === null
        ? ''
        : dispatchAttempt === null
          ? 'AND dispatch_token = $4::uuid'
          : 'AND dispatch_token = $5::uuid';
    const params =
      dispatchToken === null
        ? dispatchAttempt === null
          ? [tenantId, workflowId, activationId]
          : [tenantId, workflowId, activationId, dispatchAttempt]
        : dispatchAttempt === null
          ? [tenantId, workflowId, activationId, dispatchToken]
          : [tenantId, workflowId, activationId, dispatchAttempt, dispatchToken];
    const result = await client.query<{ id: string }>(
      `SELECT id
         FROM workflow_activations
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND id = $3
          AND activation_id = $3
          AND state = 'processing'
          AND consumed_at IS NULL
          ${dispatchAttemptClause}
          ${dispatchTokenClause}
        FOR UPDATE`,
      params,
    );
    return (result.rowCount ?? 0) > 0;
  }

  private async lockQueuedActivation(
    tenantId: string,
    activationId: string,
    client: DatabaseClient,
  ): Promise<QueuedActivationRow | null> {
    const result = await client.query<QueuedActivationRow>(
      `SELECT id, tenant_id, workflow_id, activation_id, request_id, reason, event_type, payload,
              state, dispatch_attempt, dispatch_token, queued_at, started_at, consumed_at, completed_at, summary, error
         FROM workflow_activations
        WHERE tenant_id = $1
          AND id = $2
          AND consumed_at IS NULL
          AND activation_id IS NULL
          AND state = 'queued'
        FOR UPDATE SKIP LOCKED`,
      [tenantId, activationId],
    );
    return result.rows[0] ?? null;
  }

  private async hasActiveOrchestratorTask(
    tenantId: string,
    workflowId: string,
    client: DatabaseClient,
  ): Promise<boolean> {
    const result = await client.query(
      `SELECT 1
         FROM tasks
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND is_orchestrator_task = true
          AND state = ANY($3::task_state[])
        LIMIT 1`,
      [tenantId, workflowId, ACTIVE_ORCHESTRATOR_TASK_STATES],
    );
    return (result.rowCount ?? 0) > 0;
  }

  private async hasActiveSpecialistTask(
    tenantId: string,
    workflowId: string,
    client: DatabaseClient,
  ): Promise<boolean> {
    const result = await client.query(
      `SELECT 1
         FROM tasks
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND is_orchestrator_task = false
          AND state = ANY($3::task_state[])
        LIMIT 1`,
      [tenantId, workflowId, ACTIVE_SPECIALIST_HEARTBEAT_SKIP_STATES],
    );
    return (result.rowCount ?? 0) > 0;
  }

  private async completeHeartbeatWithoutDispatch(
    activation: QueuedActivationRow,
    client: DatabaseClient,
  ): Promise<void> {
    const result = await client.query<QueuedActivationRow>(
      `UPDATE workflow_activations
          SET state = 'completed',
              activation_id = id,
              started_at = now(),
              consumed_at = now(),
              completed_at = now(),
              summary = $4,
              dispatch_attempt = dispatch_attempt + 1,
              dispatch_token = NULL,
              error = NULL
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND id = $3
          AND consumed_at IS NULL
      RETURNING id, tenant_id, workflow_id, activation_id, request_id, reason, event_type, payload,
                state, dispatch_attempt, dispatch_token, queued_at, started_at, consumed_at, completed_at, summary, error`,
      [
        activation.tenant_id,
        activation.workflow_id,
        activation.id,
        'heartbeat skipped while specialist work is still in progress',
      ],
    );
    const completed = result.rows[0];
    if (!completed) {
      return;
    }

    await this.deps.eventService.emit(
      {
        tenantId: completed.tenant_id,
        type: 'workflow.activation_completed',
        entityType: 'workflow',
        entityId: completed.workflow_id,
        actorType: 'system',
        actorId: 'workflow_activation_dispatcher',
        data: {
          activation_id: completed.id,
          event_type: 'heartbeat',
          reason: 'heartbeat',
          task_id: null,
          event_count: 0,
          summary: completed.summary,
        },
      },
      client,
    );
  }

  private async hasProcessingActivation(
    tenantId: string,
    workflowId: string,
    activationId: string,
    client: DatabaseClient,
  ): Promise<boolean> {
    const result = await client.query(
      `SELECT 1
         FROM workflow_activations
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND state = 'processing'
          AND consumed_at IS NULL
          AND id = activation_id
          AND id <> $3
        LIMIT 1`,
      [tenantId, workflowId, activationId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  private async hasActiveReplacementTask(
    tenantId: string,
    workflowId: string,
    activationId: string,
    taskId: string | null,
    client: DatabaseClient,
  ): Promise<boolean> {
    const result = await client.query(
      `SELECT 1
         FROM tasks
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND activation_id = $3
          AND is_orchestrator_task = true
          AND state = ANY($4::task_state[])
          AND ($5::uuid IS NULL OR id <> $5::uuid)
        LIMIT 1`,
      [tenantId, workflowId, activationId, ACTIVE_ORCHESTRATOR_TASK_STATES, taskId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  private async loadWorkflowForDispatch(
    tenantId: string,
    workflowId: string,
    client: DatabaseClient,
  ): Promise<WorkflowDispatchRow | null> {
    const result = await client.query<WorkflowDispatchSourceRow>(
      `SELECT w.id,
              w.name,
              w.workspace_id,
              w.lifecycle,
              w.playbook_id,
              p.name AS playbook_name,
              p.outcome AS playbook_outcome,
              p.definition AS playbook_definition,
              proj.repository_url AS workspace_repository_url,
              proj.settings AS workspace_settings,
              w.git_branch AS workflow_git_branch,
              w.parameters AS workflow_parameters
         FROM workflows w
         JOIN playbooks p
           ON p.tenant_id = w.tenant_id
          AND p.id = w.playbook_id
         LEFT JOIN workspaces proj
           ON proj.tenant_id = w.tenant_id
          AND proj.id = w.workspace_id
        WHERE w.tenant_id = $1
          AND w.id = $2
          AND w.state IN ('pending', 'active')`,
      [tenantId, workflowId],
    );
    const workflow = result.rows[0];
    if (!workflow) {
      return null;
    }

    const lifecycle = workflow.lifecycle === 'ongoing' ? 'ongoing' : 'planned';
    const projection = await loadWorkflowStageProjection(client, tenantId, workflowId, {
      lifecycle,
      definition: workflow.playbook_definition,
    });

    if (lifecycle === 'ongoing') {
      return {
        ...workflow,
        lifecycle,
        active_stages: projection.activeStages,
      };
    }

    return {
      ...workflow,
      active_stages: projection.activeStages,
      current_stage: projection.currentStage,
    };
  }

  private async insertHeartbeatActivation(
    tenantId: string,
    workflowId: string,
    requestId: string,
  ): Promise<QueuedActivationRow | null> {
    const result = await this.deps.pool.query<QueuedActivationRow>(
      `INSERT INTO workflow_activations (tenant_id, workflow_id, request_id, reason, event_type, payload)
       VALUES ($1, $2, $3, 'heartbeat', 'heartbeat', '{}'::jsonb)
       ON CONFLICT (tenant_id, workflow_id, request_id)
       WHERE request_id IS NOT NULL
       DO NOTHING
       RETURNING id, tenant_id, workflow_id, activation_id, request_id, reason, event_type, payload,
                 state, dispatch_attempt, dispatch_token, queued_at, started_at, consumed_at, completed_at, summary, error`,
      [tenantId, workflowId, requestId],
    );
    const activation = result.rows[0] ?? null;
    if (!activation) {
      return null;
    }

    await this.deps.eventService.emit({
      tenantId,
      type: 'workflow.activation_queued',
      entityType: 'workflow',
      entityId: workflowId,
      actorType: 'system',
      actorId: 'workflow_activation_dispatcher',
      data: {
        activation_id: activation.id,
        event_type: 'heartbeat',
        reason: 'heartbeat',
      },
    });
    return activation;
  }

  private async claimActivationBatch(
    activation: QueuedActivationRow,
    activationDelayMs: number,
    client: DatabaseClient,
  ): Promise<QueuedActivationRow[]> {
    const dispatchToken = randomUUID();
    const dispatchEligibilityCondition = buildDispatchEligibilityCondition('', '$5');
    const result = await client.query<QueuedActivationRow>(
      `UPDATE workflow_activations
          SET activation_id = $3,
              dispatch_attempt = dispatch_attempt + 1,
              dispatch_token = $4::uuid,
              started_at = COALESCE(started_at, now()),
              state = CASE WHEN id = $3 THEN 'processing' ELSE state END
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND consumed_at IS NULL
          AND activation_id IS NULL
          AND (
            id = $3
            OR ${dispatchEligibilityCondition}
          )
      RETURNING id, tenant_id, workflow_id, activation_id, request_id, reason, event_type, payload,
                state, dispatch_attempt, dispatch_token, queued_at, started_at, consumed_at, completed_at, summary, error`,
      [activation.tenant_id, activation.workflow_id, activation.id, dispatchToken, activationDelayMs],
    );
    return result.rows.sort((left, right) => left.queued_at.getTime() - right.queued_at.getTime());
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
    const result = await client.query<ExistingActivationTaskRow>(
      `SELECT id,
              state,
              workflow_id,
              activation_id,
              is_orchestrator_task,
              title,
              metadata,
              output,
              error
         FROM tasks
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND request_id = $3
          AND is_orchestrator_task = true
        LIMIT 1`,
      [tenantId, workflowId, requestId],
    );
    const existingTask = result.rows[0] ?? null;
    if (!existingTask) {
      return null;
    }

    if (isActiveOrchestratorTaskState(existingTask.state)) {
      return { kind: 'active', taskId: existingTask.id };
    }

    if (existingTask.state === 'completed') {
      await this.finalizeActivationForTask(tenantId, { ...existingTask }, 'completed', client);
      return { kind: 'finalized', taskId: existingTask.id };
    }

    await this.reactivateExistingActivationTask(
      tenantId,
      existingTask.id,
      activationId,
      taskDefinition,
      loopContract,
      client,
    );
      return { kind: 'reactivated', taskId: existingTask.id, previousState: existingTask.state };
  }

  private async reactivateExistingActivationTask(
    tenantId: string,
    taskId: string,
    activationId: string,
    taskDefinition: ActivationTaskDefinition,
    loopContract: ActivationTaskLoopContract,
    client: DatabaseClient,
  ): Promise<void> {
    const result = await client.query(
      `UPDATE tasks
          SET state = 'ready',
              state_changed_at = now(),
              title = $3,
              stage_name = $4,
              input = $5::jsonb,
              role_config = $6::jsonb,
              environment = $7::jsonb,
              resource_bindings = $8::jsonb,
              metadata = COALESCE(metadata, '{}'::jsonb) || $9::jsonb,
              max_iterations = $10,
              llm_max_retries = $11,
              activation_id = $12::uuid,
              assigned_agent_id = NULL,
              assigned_worker_id = NULL,
              claimed_at = NULL,
              started_at = NULL,
              completed_at = NULL,
              output = NULL,
              error = NULL,
              metrics = NULL,
              git_info = NULL,
              updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
          AND is_orchestrator_task = true`,
      [
        tenantId,
        taskId,
        taskDefinition.title,
        taskDefinition.stageName,
        taskDefinition.input,
        taskDefinition.roleConfig,
        taskDefinition.environment,
        JSON.stringify(taskDefinition.resourceBindings),
        taskDefinition.metadata,
        loopContract.maxIterations,
        loopContract.llmMaxRetries,
        activationId,
      ],
    );
    if (!result.rowCount) {
      throw new Error('Failed to reactivate existing orchestrator task');
    }
  }

  private async recoverStaleActivation(
    tenantId: string,
    activationId: string,
  ): Promise<ActivationRecoveryResult> {
    const client = await this.deps.pool.connect();

    try {
      await client.query('BEGIN');

      const staleState = await this.loadStaleActivationState(tenantId, activationId, client);
      if (!staleState) {
        await client.query('COMMIT');
        return { requeued: 0, redispatched: 0, reported: 0, details: [] };
      }

      if (staleState.active_task_id) {
        if (hasReportedStaleRecovery(staleState.error, staleState.active_task_id)) {
          await client.query('COMMIT');
          return { requeued: 0, redispatched: 0, reported: 0, details: [] };
        }
        await this.markRecoveryDetected(staleState, client);
        await this.deps.eventService.emit(
          {
            tenantId,
            type: 'workflow.activation_stale_detected',
            entityType: 'workflow',
            entityId: staleState.workflow_id,
            actorType: 'system',
            actorId: 'workflow_activation_dispatcher',
            data: {
              activation_id: staleState.id,
              task_id: staleState.active_task_id,
              event_type: staleState.event_type,
              reason: staleState.reason,
              started_at: staleState.started_at?.toISOString() ?? null,
            },
          },
          client,
        );
        await client.query('COMMIT');
        return {
          requeued: 0,
          redispatched: 0,
          reported: 1,
          details: [
            {
              activation_id: staleState.id,
              workflow_id: staleState.workflow_id,
              status: 'stale_detected',
              reason: 'orchestrator_task_still_active',
              stale_started_at: staleState.started_at?.toISOString() ?? null,
              detected_at: new Date().toISOString(),
              task_id: staleState.active_task_id,
            },
          ],
        };
      }

      const timingDefaults = await this.readActivationTimingDefaults();
      const recovered = await client.query<QueuedActivationRow>(
        `UPDATE workflow_activations
            SET state = 'queued',
                activation_id = NULL,
                dispatch_token = NULL,
                started_at = NULL,
                summary = COALESCE(summary, 'Recovered stale workflow activation'),
                error = jsonb_strip_nulls(
                  COALESCE(error, '{}'::jsonb)
                  || jsonb_build_object(
                    'message', 'Recovered stale workflow activation',
                    'recovery', jsonb_build_object(
                      'status', 'requeued',
                      'reason', 'missing_orchestrator_task',
                      'detected_at', now(),
                      'recovered_at', now(),
                      'stale_started_at', $4::timestamptz,
                      'stale_after_ms', $5::integer
                    )
                  )
                )
          WHERE tenant_id = $1
            AND workflow_id = $2
            AND (id = $3 OR activation_id = $3)
            AND consumed_at IS NULL
        RETURNING id, tenant_id, workflow_id, activation_id, request_id, reason, event_type, payload,
                  state, dispatch_attempt, dispatch_token, queued_at, started_at, consumed_at, completed_at, summary, error`,
        [
          tenantId,
          staleState.workflow_id,
          staleState.id,
          staleState.started_at?.toISOString() ?? null,
          timingDefaults.staleAfterMs,
        ],
      );
      if (!recovered.rowCount) {
        await client.query('COMMIT');
        return { requeued: 0, redispatched: 0, reported: 0, details: [] };
      }

      const recoveredAnchor = findActivationAnchor(staleState.id, recovered.rows);
      const recoveredReason = deriveActivationReason(recovered.rows);
      const recoveredPrimaryEvent = derivePrimaryActivationEvent(recoveredAnchor, recovered.rows);
      await this.deps.eventService.emit(
        {
          tenantId,
          type: 'workflow.activation_requeued',
          entityType: 'workflow',
          entityId: staleState.workflow_id,
          actorType: 'system',
          actorId: 'workflow_activation_dispatcher',
          data: {
            activation_id: staleState.id,
            event_type: recoveredPrimaryEvent.event_type,
            reason: recoveredReason,
            event_count: countDispatchableEvents(recovered.rows),
          },
        },
        client,
      );

      await client.query('COMMIT');

      const taskId = await this.dispatchActivation(tenantId, staleState.id, undefined, {
        ignoreDelay: true,
      });
      if (taskId) {
        await this.markRecoveryRedispatched(
          tenantId,
          staleState.workflow_id,
          staleState.id,
          taskId,
        );
      }
      return {
        requeued: 1,
        redispatched: taskId ? 1 : 0,
        reported: 1,
        details: [
          {
            activation_id: staleState.id,
            workflow_id: staleState.workflow_id,
            status: taskId ? 'redispatched' : 'requeued',
            reason: 'missing_orchestrator_task',
            stale_started_at: staleState.started_at?.toISOString() ?? null,
            detected_at: new Date().toISOString(),
            redispatched_task_id: taskId,
          },
        ],
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async loadStaleActivationState(
    tenantId: string,
    activationId: string,
    client: DatabaseClient,
  ): Promise<StaleActivationStateRow | null> {
    const result = await client.query<StaleActivationStateRow>(
      `SELECT wa.id,
              wa.tenant_id,
              wa.workflow_id,
              wa.activation_id,
              wa.request_id,
              wa.reason,
              wa.event_type,
              wa.payload,
              wa.state,
              wa.dispatch_attempt,
              wa.dispatch_token,
              wa.queued_at,
              wa.started_at,
              wa.consumed_at,
              wa.completed_at,
              wa.summary,
              wa.error,
              (
                SELECT t.id
                  FROM tasks t
                 WHERE t.tenant_id = wa.tenant_id
                   AND t.workflow_id = wa.workflow_id
                   AND t.activation_id = wa.id
                   AND t.is_orchestrator_task = true
                   AND t.state = ANY($3::task_state[])
                 LIMIT 1
              ) AS active_task_id
         FROM workflow_activations wa
        WHERE wa.tenant_id = $1
          AND wa.id = $2
          AND wa.state = 'processing'
          AND wa.id = wa.activation_id
          AND wa.consumed_at IS NULL
        FOR UPDATE SKIP LOCKED`,
      [tenantId, activationId, ACTIVE_ORCHESTRATOR_TASK_STATES],
    );
    return result.rows[0] ?? null;
  }

  private async markRecoveryDetected(
    staleState: StaleActivationStateRow,
    client: DatabaseClient,
  ): Promise<void> {
    const timingDefaults = await this.readActivationTimingDefaults();
    await client.query(
      `UPDATE workflow_activations
          SET summary = COALESCE(summary, 'Stale orchestrator detected during activation recovery'),
              error = jsonb_strip_nulls(
                COALESCE(error, '{}'::jsonb)
                || jsonb_build_object(
                  'recovery', jsonb_build_object(
                    'status', 'stale_detected',
                    'reason', 'orchestrator_task_still_active',
                    'detected_at', now(),
                    'stale_started_at', $4::timestamptz,
                    'stale_after_ms', $5::integer,
                    'task_id', $6::uuid
                  )
                )
              )
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND (id = $3 OR activation_id = $3)
          AND consumed_at IS NULL`,
      [
        staleState.tenant_id,
        staleState.workflow_id,
        staleState.id,
        staleState.started_at?.toISOString() ?? null,
        timingDefaults.staleAfterMs,
        staleState.active_task_id,
      ],
    );
  }

  private async markRecoveryRedispatched(
    tenantId: string,
    workflowId: string,
    activationId: string,
    taskId: string,
  ): Promise<void> {
    await this.deps.pool.query(
      `UPDATE workflow_activations
          SET error = jsonb_strip_nulls(
                COALESCE(error, '{}'::jsonb)
                || jsonb_build_object(
                  'recovery', COALESCE(error->'recovery', '{}'::jsonb)
                    || jsonb_build_object(
                      'status', 'redispatched',
                      'redispatched_at', now(),
                      'redispatched_task_id', $4::uuid
                    )
                )
              )
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND (id = $3 OR activation_id = $3)
          AND consumed_at IS NULL`,
      [tenantId, workflowId, activationId, taskId],
    );
  }

  private async readActivationTimingDefaults() {
    return readWorkflowActivationTimingDefaults(this.deps.pool, DEFAULT_TENANT_ID);
  }

  private async resolveDefaultTaskTimeoutMinutes(
    tenantId: string,
    client: DatabaseClient,
  ): Promise<number> {
    return readRequiredPositiveIntegerRuntimeDefault(
      client,
      tenantId,
      TASK_DEFAULT_TIMEOUT_MINUTES_RUNTIME_KEY,
    );
  }

  private async resolveActivationTaskLoopContract(
    tenantId: string,
    workflow: WorkflowDispatchRow,
    client: DatabaseClient,
  ): Promise<ActivationTaskLoopContract> {
    const orchestrator = asRecord(asRecord(workflow.playbook_definition).orchestrator);
    const maxIterations = readPositiveInteger(orchestrator.max_iterations)
      ?? await readRequiredPositiveIntegerRuntimeDefault(
        client,
        tenantId,
        TASK_MAX_ITERATIONS_RUNTIME_KEY,
      );
    const llmMaxRetries = readPositiveInteger(orchestrator.llm_max_retries)
      ?? await readRequiredPositiveIntegerRuntimeDefault(
        client,
        tenantId,
        TASK_LLM_MAX_RETRIES_RUNTIME_KEY,
      );

    return {
      maxIterations,
      llmMaxRetries,
    };
  }
}

function buildActivationTaskTitle(
  workflow: WorkflowDispatchRow,
  activation: QueuedActivationRow,
): string {
  return `Orchestrate ${workflow.name}: ${activation.reason}`;
}

function buildActivationTaskDefinition(
  workflow: WorkflowDispatchRow,
  activation: QueuedActivationRow,
  activationBatch: QueuedActivationRow[],
): ActivationTaskDefinition {
  const repository = resolveWorkflowRepositoryContext(workflow);
  const activationReason = deriveActivationReason(activationBatch);
  const primaryEvent = derivePrimaryActivationEvent(activation, activationBatch);
  return {
    title: buildActivationTaskTitle(workflow, primaryEvent),
    stageName: activationTaskStageName(workflow, activationBatch),
    input: buildActivationTaskInput(workflow, activation, primaryEvent, activationBatch),
    roleConfig: buildActivationRoleConfig(),
    environment: buildActivationEnvironment(repository),
    resourceBindings: buildActivationResourceBindings(repository),
    metadata: {
      activation_event_type: primaryEvent.event_type,
      activation_reason: activationReason,
      activation_request_id: primaryEvent.request_id,
      activation_event_count: countDispatchableEvents(activationBatch),
      activation_dispatch_attempt: activation.dispatch_attempt,
      activation_dispatch_token: activation.dispatch_token,
    },
  };
}

function buildActivationTaskInput(
  workflow: WorkflowDispatchRow,
  activation: QueuedActivationRow,
  primaryEvent: QueuedActivationRow,
  activationBatch: QueuedActivationRow[],
): Record<string, unknown> {
  const repository = resolveWorkflowRepositoryContext(workflow);
  const activationReason = deriveActivationReason(activationBatch);
  const queuedEvents =
    activationReason === 'heartbeat'
      ? []
      : activationBatch
        .filter((event) => event.event_type !== 'heartbeat')
        .map((event) => ({
          queue_id: event.id,
          type: event.event_type,
          reason: event.reason,
          payload: event.payload,
          work_item_id: asNullableString(event.payload.work_item_id),
          stage_name: asNullableString(event.payload.stage_name),
          timestamp: event.queued_at.toISOString(),
        }));
  const primaryEventDetails = formatActivationEventDetails(primaryEvent);
  const queuedEventDetails = queuedEvents
    .map((event) => formatActivationEventDetailsFromFields(event.type, event.payload))
    .filter((value): value is string => value !== null);
  return {
    activation_id: activation.id,
    activation_reason: activationReason,
    activation_dispatch_attempt: activation.dispatch_attempt,
    activation_dispatch_token: activation.dispatch_token,
    lifecycle: workflow.lifecycle,
    ...(workflow.lifecycle !== 'ongoing' ? { current_stage: workflow.current_stage } : {}),
    active_stages: workflow.active_stages,
    repository: buildActivationRepositoryInput(repository),
    events: queuedEvents,
    description: [
      `You are the workflow orchestrator for "${workflow.name}" (${workflow.playbook_name}).`,
      `Reason for this activation: ${activationReason}.`,
      activationReason === 'heartbeat'
        ? 'No queued events were present. Proactively inspect stale tasks, blocked work, and overall workflow health.'
        : `Queued events in this batch: ${queuedEvents.length}.`,
      `Primary trigger event: ${primaryEvent.event_type}.`,
      primaryEventDetails ? `Primary trigger details: ${primaryEventDetails}.` : null,
      queuedEventDetails.length > 0
        ? `Queued event details: ${queuedEventDetails.join('; ')}.`
        : null,
      workflow.active_stages.length > 0
        ? `Active stages in open work: ${workflow.active_stages.join(', ')}.`
        : null,
      workflow.playbook_outcome
        ? `Target outcome: ${workflow.playbook_outcome}.`
        : null,
      repository.repository_url
        ? `Repository: ${repository.repository_url}.`
        : null,
      repository.base_branch
        ? `Base branch: ${repository.base_branch}.`
        : null,
      repository.feature_branch
        ? `Feature branch for repo-backed specialist work: ${repository.feature_branch}.`
        : null,
      'Review the attached workflow, playbook, work item, and activation context before deciding on the next step.',
      'Use the available workflow management tools to create work items, create tasks, advance stages, request gates, review task outputs, and update workspace memory when needed.',
      'Every mutating workflow management tool call must include a unique request_id.',
      'Repository-backed specialist tasks must include repository execution context so the runtime can clone, validate, commit, and push safely.',
      'Use the repository, git, shell, artifact, and escalation tools to validate the situation before acting.',
      'If you conclude that a planned workflow should progress, perform the required workflow mutation in the same activation instead of stopping at a recommendation.',
      'Return a concise operator-facing summary of what changed, what is blocked, and the next action you recommend.',
    ]
      .filter((line): line is string => Boolean(line))
      .join('\n'),
    acceptance_criteria: [
      'Describe the activation trigger and affected workflow state.',
      'Reference any impacted work items or tasks by ID when relevant.',
      'State the next recommended workflow action clearly.',
    ],
  };
}

function buildImmediateDispatchCondition(alias: string): string {
  const prefix = alias.trim().length > 0 ? `${alias}.` : '';
  return IMMEDIATE_QUEUE_DISPATCH_EVENT_TYPES.map((eventType) => `${prefix}event_type = '${eventType}'`).join('\n            OR ');
}

function buildDispatchEligibilityCondition(alias: string, delayPlaceholder: string): string {
  const prefix = alias.trim().length > 0 ? `${alias}.` : '';
  return [
    buildImmediateDispatchCondition(alias),
    `${prefix}event_type = 'heartbeat'`,
    `${prefix}queued_at <= now() - (${delayPlaceholder} * interval '1 millisecond')`,
  ].join('\n            OR ');
}

function isImmediateDispatchEvent(eventType: string): boolean {
  return IMMEDIATE_QUEUE_DISPATCH_EVENT_TYPES.includes(
    eventType as (typeof IMMEDIATE_QUEUE_DISPATCH_EVENT_TYPES)[number],
  );
}

function deriveActivationReason(activationBatch: QueuedActivationRow[]): 'queued_events' | 'heartbeat' {
  return activationBatch.some((event) => event.event_type !== 'heartbeat') ? 'queued_events' : 'heartbeat';
}

function countDispatchableEvents(activationBatch: QueuedActivationRow[]): number {
  return activationBatch.filter((event) => event.event_type !== 'heartbeat').length;
}

function derivePrimaryActivationEvent(
  activation: QueuedActivationRow,
  activationBatch: QueuedActivationRow[],
): QueuedActivationRow {
  return activationBatch.find((event) => event.event_type !== 'heartbeat') ?? activation;
}

function formatActivationEventDetails(event: QueuedActivationRow): string | null {
  return formatActivationEventDetailsFromFields(event.event_type, event.payload);
}

function formatActivationEventDetailsFromFields(
  eventType: string,
  payload: Record<string, unknown>,
): string | null {
  const details = [
    asNullableString(payload.task_id) ? `task_id=${asNullableString(payload.task_id)}` : null,
    asNullableString(payload.task_role) ? `task_role=${asNullableString(payload.task_role)}` : null,
    asNullableString(payload.stage_name) ? `stage_name=${asNullableString(payload.stage_name)}` : null,
    asNullableString(payload.work_item_id) ? `work_item_id=${asNullableString(payload.work_item_id)}` : null,
  ].filter((value): value is string => Boolean(value));

  if (details.length === 0) {
    return null;
  }

  return `${eventType} (${details.join(', ')})`;
}

function buildActivationTaskRequestId(activation: QueuedActivationRow): string {
  return `activation:${activation.id}:dispatch:${activation.dispatch_attempt}`;
}

function activationTaskStageName(
  workflow: WorkflowDispatchRow,
  activationBatch: QueuedActivationRow[],
): string | null {
  if (workflow.lifecycle !== 'ongoing') {
    return workflow.current_stage ?? null;
  }
  const eventStages = uniqueStageNames(activationBatch);
  if (eventStages.length === 1) {
    return eventStages[0];
  }
  if (workflow.active_stages.length === 1) {
    return workflow.active_stages[0];
  }
  return null;
}

function uniqueStageNames(activationBatch: QueuedActivationRow[]): string[] {
  return Array.from(
    new Set(
      activationBatch
        .map((event) => asNullableString(event.payload.stage_name))
        .filter((stageName): stageName is string => Boolean(stageName)),
    ),
  );
}

function buildActivationRoleConfig(): Record<string, unknown> {
  return {
    system_prompt: [
      'You are the workflow orchestrator.',
      'Assess workflow state, inspect repository artifacts when needed, and take the next management action directly through the workflow control tools.',
      'Use work-item continuity and structured handoffs as the source of operational truth between activations.',
      'After you dispatch required specialist work, request a gate, or detect active subordinate work with no new routing decision to make, finish the activation and wait for the next event.',
      'If no subordinate work is active and the workflow should progress, perform the workflow mutation now rather than ending with only a recommendation.',
      'Do not poll running tasks in a loop.',
      'If a stage already awaits approval, do not request another gate; finish the activation and wait for the decision event.',
      'Always include a unique request_id on mutating workflow control tool calls.',
      'When assigning repository-backed specialist work, include the repository execution context and required git binding details in the task payload.',
      'Be brief, concrete, and operational.',
    ].join(' '),
    tools: [
      'memory_read',
      'memory_write',
      'artifact_list',
      'artifact_read',
      'artifact_document_read',
      'submit_handoff',
      'read_predecessor_handoff',
      'list_work_items',
      'list_workflow_tasks',
      'read_task_output',
      'read_task_status',
      'read_task_events',
      'read_escalation',
      'read_stage_status',
      'read_workflow_budget',
      'read_work_item_continuity',
      'read_latest_handoff',
      'read_handoff_chain',
      'update_task_input',
      'create_work_item',
      'update_work_item',
      'complete_work_item',
      'create_task',
      'create_workflow',
      'request_gate_approval',
      'approve_task',
      'approve_task_output',
      'request_rework',
      'advance_stage',
      'complete_workflow',
      'cancel_task',
      'memory_delete',
      'work_item_memory_read',
      'work_item_memory_history',
      'reassign_task',
      'retry_task',
      'send_task_message',
      'file_read',
      'file_list',
      'file_edit',
      'file_write',
      'shell_exec',
      'git_status',
      'git_diff',
      'git_log',
      'git_commit',
      'git_push',
      'artifact_upload',
      'web_fetch',
      'escalate',
    ],
  };
}

interface WorkflowRepositoryContext {
  repository_url: string | null;
  base_branch: string | null;
  feature_branch: string | null;
  git_user_name: string | null;
  git_user_email: string | null;
  git_token_secret_ref: string | null;
}

function resolveWorkflowRepositoryContext(workflow: WorkflowDispatchRow): WorkflowRepositoryContext {
  const storage = resolveWorkspaceStorageBinding({
    repository_url: workflow.workspace_repository_url,
    settings: workflow.workspace_settings,
  });
  return {
    repository_url: storage.type === 'git_remote' ? storage.repository_url : null,
    base_branch: storage.type === 'git_remote' ? storage.default_branch : null,
    feature_branch: null,
    git_user_name: storage.type === 'git_remote' ? storage.git_user_name : null,
    git_user_email: storage.type === 'git_remote' ? storage.git_user_email : null,
    git_token_secret_ref:
      storage.type === 'git_remote' ? storage.git_token_secret_ref : null,
  };
}

function buildActivationEnvironment(repository: WorkflowRepositoryContext): Record<string, unknown> {
  return {
    execution_mode: 'orchestrator',
    ...(repository.repository_url ? { template: DEFAULT_REPOSITORY_TASK_TEMPLATE } : {}),
    ...(repository.repository_url ? { repository_url: repository.repository_url } : {}),
    ...(repository.base_branch ? { branch: repository.base_branch } : {}),
    ...(repository.git_user_name ? { git_user_name: repository.git_user_name } : {}),
    ...(repository.git_user_email ? { git_user_email: repository.git_user_email } : {}),
  };
}

function buildActivationRepositoryInput(repository: WorkflowRepositoryContext): Record<string, unknown> | null {
  const details = {
    ...(repository.repository_url ? { repository_url: repository.repository_url } : {}),
    ...(repository.base_branch ? { base_branch: repository.base_branch } : {}),
    ...(repository.feature_branch ? { feature_branch: repository.feature_branch } : {}),
    ...(repository.git_user_name ? { git_user_name: repository.git_user_name } : {}),
    ...(repository.git_user_email ? { git_user_email: repository.git_user_email } : {}),
  };
  return Object.keys(details).length > 0 ? details : null;
}

function buildActivationResourceBindings(repository: WorkflowRepositoryContext): Record<string, unknown>[] {
  return buildGitRemoteResourceBindings({
    type: 'git_remote',
    working_directory: '/workspace/repo',
    repository_url: repository.repository_url,
    default_branch: repository.base_branch,
    git_user_name: repository.git_user_name,
    git_user_email: repository.git_user_email,
    git_token_secret_ref: repository.git_token_secret_ref,
  });
}

function buildActivationSummary(
  task: Record<string, unknown>,
  status: 'completed' | 'failed',
): string | null {
  if (status === 'failed') {
    const error = task.error as Record<string, unknown> | null;
    const message = typeof error?.message === 'string' ? error.message.trim() : '';
    return message || 'Orchestrator activation failed';
  }

  const output = task.output as Record<string, unknown> | null;
  const summary = typeof output?.summary === 'string' ? output.summary.trim() : '';
  if (summary) {
    return summary;
  }

  const resultSummary = typeof task.title === 'string' ? String(task.title).trim() : '';
  return resultSummary || null;
}

function findActivationAnchor(
  activationId: string,
  rows: QueuedActivationRow[],
): QueuedActivationRow {
  return rows.find((row) => row.id === activationId) ?? rows[0];
}

function asNullableString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readTaskDispatchAttempt(task: Record<string, unknown>): number | null {
  const metadata = task.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return readTaskDispatchAttemptFromRequestId(task);
  }
  const value = (metadata as Record<string, unknown>).activation_dispatch_attempt;
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  return readTaskDispatchAttemptFromRequestId(task);
}

function readTaskDispatchToken(task: Record<string, unknown>): string | null {
  const metadata = task.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }
  const value = (metadata as Record<string, unknown>).activation_dispatch_token;
  if (typeof value !== 'string') {
    return null;
  }
  const token = value.trim();
  return UUID_PATTERN.test(token) ? token : null;
}

function readTaskDispatchAttemptFromRequestId(task: Record<string, unknown>): number | null {
  const requestId =
    typeof task.request_id === 'string' && task.request_id.trim().length > 0
      ? task.request_id.trim()
      : null;
  const activationId =
    typeof task.activation_id === 'string' && task.activation_id.trim().length > 0
      ? task.activation_id.trim()
      : null;
  if (!requestId || !activationId) {
    return null;
  }

  const match = ACTIVATION_TASK_REQUEST_ID_PATTERN.exec(requestId);
  if (!match || match[1] !== activationId) {
    return null;
  }

  const attempt = Number.parseInt(match[2], 10);
  return Number.isSafeInteger(attempt) && attempt >= 1 ? attempt : null;
}

function isReadyForDispatch(activation: QueuedActivationRow, activationDelayMs: number): boolean {
  if (activation.event_type === 'heartbeat' || isImmediateDispatchEvent(activation.event_type)) {
    return true;
  }

  return Date.now() - activation.queued_at.getTime() >= activationDelayMs;
}

function buildHeartbeatRequestId(workflowId: string, heartbeatIntervalMs: number): string {
  const bucket = Math.floor(Date.now() / heartbeatIntervalMs);
  return `heartbeat:${workflowId}:${bucket}`;
}

function hasReportedStaleRecovery(
  error: Record<string, unknown> | null,
  activeTaskId: string,
): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const recovery = error.recovery;
  if (!recovery || typeof recovery !== 'object') {
    return false;
  }
  const recoveryRecord = recovery as Record<string, unknown>;
  const status = typeof recoveryRecord.status === 'string' ? recoveryRecord.status : null;
  const taskId = typeof recoveryRecord.task_id === 'string' ? recoveryRecord.task_id : null;
  return status === 'stale_detected' && taskId === activeTaskId;
}

function isActiveOrchestratorTaskState(state: string | null): boolean {
  return state != null && ACTIVE_ORCHESTRATOR_TASK_STATES.includes(state as (typeof ACTIVE_ORCHESTRATOR_TASK_STATES)[number]);
}

function isActiveActivationConstraintError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const record = error as { code?: string; constraint?: string };
  return record.code === '23505' && record.constraint === 'idx_workflow_activations_active';
}
