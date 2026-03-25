import type { ApiKeyIdentity } from '../auth/api-key.js';
import { isOperatorScope } from '../auth/scope.js';
import { ForbiddenError, NotFoundError } from '../errors/domain-errors.js';
import { toStoredTaskState, type TaskState } from '../orchestration/task-state-machine.js';
import { assertValidWorkerTransition, type WorkerState } from '../orchestration/worker-state-machine.js';
import type { WorkerHeartbeatInput, WorkerServiceContext } from './worker-service.js';

const ACTIVE_EXECUTION_STATES: TaskState[] = ['claimed', 'in_progress'];
const STORED_ACTIVE_EXECUTION_STATES = ACTIVE_EXECUTION_STATES.map(toStoredTaskState);

export function ensureWorkerAccess(identity: ApiKeyIdentity, workerId: string): void {
  if (isOperatorScope(identity.scope)) {
    return;
  }
  if (identity.scope === 'worker' && identity.ownerId === workerId) {
    return;
  }
  throw new ForbiddenError('Worker identity mismatch');
}

function assertValidHeartbeatTransition(workerId: string, from: WorkerState, to: WorkerState): void {
  if (from === 'disconnected' && to !== 'disconnected' && to !== 'online' && to !== 'offline') {
    // Reconnecting workers may immediately report their active runtime state (e.g. busy)
    // rather than sending an intermediate "online" heartbeat first.
    assertValidWorkerTransition(workerId, from, 'online');
    assertValidWorkerTransition(workerId, 'online', to);
    return;
  }

  assertValidWorkerTransition(workerId, from, to);
}

export async function heartbeat(
  context: WorkerServiceContext,
  identity: ApiKeyIdentity,
  workerId: string,
  payload: WorkerHeartbeatInput,
) {
  ensureWorkerAccess(identity, workerId);
  const workerRes = await context.pool.query('SELECT * FROM workers WHERE tenant_id = $1 AND id = $2', [
    identity.tenantId,
    workerId,
  ]);
  if (!workerRes.rowCount) {
    throw new NotFoundError('Worker not found');
  }

  const previousStatus = workerRes.rows[0].status as WorkerState;
  const status = (payload.status ?? 'online') as WorkerState;
  assertValidHeartbeatTransition(workerId, previousStatus, status);
  const currentTaskId = payload.current_task_id ?? payload.current_tasks?.[0] ?? null;
  await context.pool.query(
    `UPDATE workers
     SET status = $3,
         current_task_id = $4,
         metadata = metadata || jsonb_build_object('metrics', $5::jsonb),
         last_heartbeat_at = now()
     WHERE tenant_id = $1 AND id = $2`,
    [identity.tenantId, workerId, status, currentTaskId, payload.metrics ?? {}],
  );

  await reconcileStaleClaimedTasks(context, identity.tenantId, workerId, currentTaskId);

  const pendingSignals = await context.pool.query(
    `SELECT id, signal_type, task_id, data, created_at
     FROM worker_signals
     WHERE tenant_id = $1 AND worker_id = $2 AND delivered = false
     ORDER BY created_at ASC`,
    [identity.tenantId, workerId],
  );

  return {
    ack: true,
    pending_signals: pendingSignals.rows.map((row) => ({
      id: row.id,
      type: row.signal_type,
      task_id: row.task_id,
      data: row.data,
      issued_at: row.created_at,
    })),
  };
}

async function reconcileStaleClaimedTasks(
  context: WorkerServiceContext,
  tenantId: string,
  workerId: string,
  currentTaskId: string | null,
) {
  if (currentTaskId) {
    return;
  }

  const staleClaims = await context.pool.query<{ id: string }>(
    `SELECT id
       FROM tasks
      WHERE tenant_id = $1
        AND assigned_worker_id = $2
        AND state = 'claimed'
        AND started_at IS NULL`,
    [tenantId, workerId],
  );
  if (!staleClaims.rowCount) {
    return;
  }

  const taskIds = staleClaims.rows.map((row) => row.id);
  await context.pool.query(
    `UPDATE tasks
        SET state = 'ready',
            state_changed_at = now(),
            assigned_agent_id = NULL,
            assigned_worker_id = NULL,
            claimed_at = NULL
      WHERE tenant_id = $1
        AND id = ANY($2::uuid[])`,
    [tenantId, taskIds],
  );
  await context.pool.query(
    `UPDATE agents
        SET current_task_id = NULL,
            status = 'active',
            last_heartbeat_at = now()
      WHERE tenant_id = $1
        AND worker_id = $2
        AND current_task_id = ANY($3::uuid[])`,
    [tenantId, workerId, taskIds],
  );

  for (const taskId of taskIds) {
    await context.eventService.emit({
      tenantId,
      type: 'task.state_changed',
      entityType: 'task',
      entityId: taskId,
      actorType: 'system',
      actorId: 'worker_heartbeat',
      data: {
        from_state: 'claimed',
        to_state: 'ready',
        reason: 'worker_reported_no_current_task',
        worker_id: workerId,
      },
    });
  }
}

export async function enforceHeartbeatTimeouts(context: WorkerServiceContext, now = new Date()): Promise<number> {
  const workers = await context.pool.query(
    `SELECT id, tenant_id, status, heartbeat_interval_seconds, last_heartbeat_at
     FROM workers
     WHERE last_heartbeat_at IS NOT NULL
       AND (
         (
           status = 'online'
           AND last_heartbeat_at < ($1::timestamptz - (heartbeat_interval_seconds * 1000 * $2::double precision * INTERVAL '1 millisecond'))
         )
         OR (
           status IN ('busy', 'draining', 'degraded')
           AND last_heartbeat_at < ($1::timestamptz - (heartbeat_interval_seconds * 1000 * $3::double precision * INTERVAL '1 millisecond'))
         )
         OR (
           status = 'disconnected'
           AND last_heartbeat_at < (
             $1::timestamptz
             - (
               (heartbeat_interval_seconds * 1000 * $3::double precision * INTERVAL '1 millisecond')
               + ($4::double precision * INTERVAL '1 millisecond')
             )
           )
         )
       )`,
    [
      now,
      context.config.WORKER_DEGRADED_THRESHOLD_MULTIPLIER,
      context.config.WORKER_OFFLINE_THRESHOLD_MULTIPLIER,
      context.config.WORKER_OFFLINE_GRACE_PERIOD_MS,
    ],
  );

  let affected = 0;
  for (const worker of workers.rows) {
    const lastHeartbeat = new Date(worker.last_heartbeat_at as string | Date).getTime();
    const intervalMs = Number(worker.heartbeat_interval_seconds) * 1000;
    const elapsed = now.getTime() - lastHeartbeat;
    const offlineCutoffMs = intervalMs * context.config.WORKER_OFFLINE_THRESHOLD_MULTIPLIER;
    const degradedCutoffMs = intervalMs * context.config.WORKER_DEGRADED_THRESHOLD_MULTIPLIER;
    const gracePeriodMs = context.config.WORKER_OFFLINE_GRACE_PERIOD_MS;

    if (elapsed >= offlineCutoffMs) {
      const graceElapsed = elapsed - offlineCutoffMs;

      if (graceElapsed < gracePeriodMs) {
        // Within grace period — transition to disconnected (tasks stay assigned)
        if (worker.status !== 'disconnected' && worker.status !== 'offline') {
          await context.pool.query(`UPDATE workers SET status = 'disconnected' WHERE tenant_id = $1 AND id = $2`, [
            worker.tenant_id,
            worker.id,
          ]);

          await context.eventService.emit({
            tenantId: worker.tenant_id,
            type: 'worker.disconnected',
            entityType: 'worker',
            entityId: worker.id,
            actorType: 'system',
            actorId: 'worker_heartbeat_monitor',
            data: {
              last_heartbeat_at: worker.last_heartbeat_at,
              grace_period_ms: gracePeriodMs,
            },
          });
          affected += 1;
        }
      } else {
        // Grace period expired — transition to offline and fail stale tasks.
        if (worker.status !== 'offline') {
          await context.pool.query(`UPDATE workers SET status = 'offline', current_task_id = NULL WHERE tenant_id = $1 AND id = $2`, [
            worker.tenant_id,
            worker.id,
          ]);

          await context.eventService.emit({
            tenantId: worker.tenant_id,
            type: 'worker.offline',
            entityType: 'worker',
            entityId: worker.id,
            actorType: 'system',
            actorId: 'worker_heartbeat_monitor',
            data: {
              last_heartbeat_at: worker.last_heartbeat_at,
              grace_period_ms: gracePeriodMs,
            },
          });
          affected += 1;
        }

        await context.pool.query(
          `UPDATE agents
           SET status = 'inactive', current_task_id = NULL
           WHERE tenant_id = $1 AND worker_id = $2`,
          [worker.tenant_id, worker.id],
        );

        const failedTasks = await context.pool.query<{ id: string }>(
          `UPDATE tasks
           SET state = 'failed',
               state_changed_at = now(),
               error = jsonb_build_object(
                 'category', 'infrastructure',
                 'message', 'Worker heartbeat timeout',
                 'recoverable', true
               ),
               assigned_worker_id = NULL,
               assigned_agent_id = NULL,
               claimed_at = NULL,
               started_at = NULL
           WHERE tenant_id = $1
             AND assigned_worker_id = $2
             AND state::text = ANY($3::text[])
           RETURNING id`,
          [worker.tenant_id, worker.id, STORED_ACTIVE_EXECUTION_STATES],
        );

        for (const failedTask of failedTasks.rows) {
          await context.eventService.emit({
            tenantId: worker.tenant_id,
            type: 'task.state_changed',
            entityType: 'task',
            entityId: failedTask.id,
            actorType: 'system',
            actorId: 'worker_heartbeat_monitor',
            data: {
              from_state: 'in_progress',
              to_state: 'failed',
              reason: 'worker_heartbeat_timeout',
              worker_id: worker.id,
            },
          });
        }

        if (failedTasks.rowCount) {
          affected += failedTasks.rowCount;
        }
      }
      continue;
    }

    if (elapsed >= degradedCutoffMs && worker.status === 'online') {
      await context.pool.query(`UPDATE workers SET status = 'degraded' WHERE tenant_id = $1 AND id = $2`, [
        worker.tenant_id,
        worker.id,
      ]);
      affected += 1;
    }
  }

  return affected;
}
