import type { DatabaseClient, DatabasePool } from '../../db/database.js';
import { DEFAULT_TENANT_ID } from '../../db/seed.js';

import { readWorkflowActivationTimingDefaults } from '../platform-config/platform-timing-defaults.js';
import { loadWorkflowStageProjection } from '../workflow-stage/workflow-stage-projection.js';

import {
  ACTIVE_ORCHESTRATOR_TASK_STATES,
  ACTIVE_SPECIALIST_HEARTBEAT_SKIP_STATES,
  BLOCKED_ACTIVATION_RECOVERY_STATUS,
  type DispatchDependencies,
  type QueuedActivationRow,
  type WorkflowDispatchRow,
  type WorkflowDispatchSourceRow,
} from './types.js';
import { buildDispatchEligibilityCondition } from './helpers.js';

export class ActivationStateStore {
  constructor(private readonly deps: DispatchDependencies) {}

  async lockFinalizableActivation(
    tenantId: string,
    workflowId: string,
    activationId: string,
    dispatchAttempt: number | null,
    dispatchToken: string | null,
    client: DatabaseClient,
  ): Promise<boolean> {
    const dispatchAttemptClause =
      dispatchAttempt === null ? 'AND dispatch_attempt >= 1' : 'AND dispatch_attempt = $4';
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

  async lockQueuedActivation(
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
          AND COALESCE(error->'recovery'->>'status', '') <> '${BLOCKED_ACTIVATION_RECOVERY_STATUS}'
        FOR UPDATE SKIP LOCKED`,
      [tenantId, activationId],
    );
    return result.rows[0] ?? null;
  }

  async hasActiveOrchestratorTask(
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

  async hasActiveSpecialistTask(
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

  async completeHeartbeatWithoutDispatch(
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

  async hasProcessingActivation(
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

  async hasActiveReplacementTask(
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

  async loadWorkflowForDispatch(
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

  async insertHeartbeatActivation(
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

  async claimActivationBatch(
    activation: QueuedActivationRow,
    activationDelayMs: number,
    dispatchToken: string,
    client: DatabaseClient,
  ): Promise<QueuedActivationRow[]> {
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

  async readActivationTimingDefaults(
    db: DatabaseClient | DatabasePool = this.deps.pool,
  ): Promise<{
    activationDelayMs: number;
    heartbeatIntervalMs: number;
    staleAfterMs: number;
  }> {
    return readWorkflowActivationTimingDefaults(db, DEFAULT_TENANT_ID);
  }
}
