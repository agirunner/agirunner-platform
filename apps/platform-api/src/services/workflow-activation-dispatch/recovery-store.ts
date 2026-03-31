import type { DatabaseClient } from '../../db/database.js';
import { DEFAULT_TENANT_ID } from '../../db/seed.js';

import { readWorkflowActivationTimingDefaults } from '../platform-timing-defaults.js';

import {
  ACTIVE_ORCHESTRATOR_TASK_STATES,
  type DispatchDependencies,
  type StaleActivationStateRow,
} from './types.js';

export class ActivationRecoveryStore {
  constructor(private readonly deps: DispatchDependencies) {}

  async loadStaleActivationState(
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

  async markRecoveryDetected(
    staleState: StaleActivationStateRow,
    client: DatabaseClient,
  ): Promise<void> {
    const timingDefaults = await readWorkflowActivationTimingDefaults(client, DEFAULT_TENANT_ID);
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

  async markRecoveryRedispatched(
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
}
