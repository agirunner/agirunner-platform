import type { DatabaseClient } from '../../db/database.js';
import { logSafetynetTriggered } from '../safetynet/logging.js';
import {
  PLATFORM_ACTIVATION_STALE_RECOVERY_ID,
  mustGetSafetynetEntry,
} from '../safetynet/registry.js';

import type {
  ActivationRecoveryResult,
  DispatchDependencies,
  DispatchOptions,
  QueuedActivationRow,
} from './types.js';
import {
  countDispatchableEvents,
  deriveActivationReason,
  derivePrimaryActivationEvent,
  findActivationAnchor,
  hasReportedStaleRecovery,
} from './helpers.js';
import { ActivationStateStore } from './activation-state-store.js';
import { ActivationRecoveryStore } from './recovery-store.js';

const STALE_ACTIVATION_RECOVERY_SAFETYNET = mustGetSafetynetEntry(
  PLATFORM_ACTIVATION_STALE_RECOVERY_ID,
);

interface RecoverStaleActivationParams {
  tenantId: string;
  activationId: string;
  deps: DispatchDependencies;
  activationStateStore: ActivationStateStore;
  activationRecoveryStore: ActivationRecoveryStore;
  dispatchActivation: (
    tenantId: string,
    activationId: string,
    existingClient?: DatabaseClient,
    options?: DispatchOptions,
  ) => Promise<string | null>;
}

export async function recoverStaleActivation({
  tenantId,
  activationId,
  deps,
  activationStateStore,
  activationRecoveryStore,
  dispatchActivation,
}: RecoverStaleActivationParams): Promise<ActivationRecoveryResult> {
  const client = await deps.pool.connect();

  try {
    await client.query('BEGIN');

    const staleState = await activationRecoveryStore.loadStaleActivationState(
      tenantId,
      activationId,
      client,
    );
    if (!staleState) {
      await client.query('COMMIT');
      return { requeued: 0, redispatched: 0, reported: 0, details: [] };
    }

    if (staleState.active_task_id) {
      if (hasReportedStaleRecovery(staleState.error, staleState.active_task_id)) {
        await client.query('COMMIT');
        return { requeued: 0, redispatched: 0, reported: 0, details: [] };
      }
      await activationRecoveryStore.markRecoveryDetected(staleState, client);
      await deps.eventService.emit(
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

    const timingDefaults = await activationStateStore.readActivationTimingDefaults(client);
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
    await deps.eventService.emit(
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

    const taskId = await dispatchActivation(tenantId, staleState.id, undefined, {
      ignoreDelay: true,
    });
    if (taskId) {
      await activationRecoveryStore.markRecoveryRedispatched(
        tenantId,
        staleState.workflow_id,
        staleState.id,
        taskId,
      );
    }
    logSafetynetTriggered(
      STALE_ACTIVATION_RECOVERY_SAFETYNET,
      taskId
        ? 'stale activation recovery requeued and redispatched a missing orchestrator task'
        : 'stale activation recovery requeued a missing orchestrator task',
      {
        workflow_id: staleState.workflow_id,
        activation_id: staleState.id,
        recovery_reason: 'missing_orchestrator_task',
        redispatched_task_id: taskId,
      },
    );
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
