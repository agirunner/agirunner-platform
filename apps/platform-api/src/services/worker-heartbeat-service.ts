import type { ApiKeyIdentity } from '../auth/api-key.js';
import { ForbiddenError, NotFoundError } from '../errors/domain-errors.js';
import { assertValidWorkerTransition, type WorkerState } from '../orchestration/worker-state-machine.js';
import type { WorkerHeartbeatInput, WorkerServiceContext } from './worker-service.js';

export function ensureWorkerAccess(identity: ApiKeyIdentity, workerId: string): void {
  if (identity.scope === 'admin') {
    return;
  }
  if (identity.scope === 'worker' && identity.ownerId === workerId) {
    return;
  }
  throw new ForbiddenError('Worker identity mismatch');
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

  const status = (payload.status ?? 'online') as WorkerState;
  assertValidWorkerTransition(workerId, workerRes.rows[0].status as WorkerState, status);
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

export async function enforceHeartbeatTimeouts(context: WorkerServiceContext, now = new Date()): Promise<number> {
  const workers = await context.pool.query(
    `SELECT id, tenant_id, status, heartbeat_interval_seconds, last_heartbeat_at
     FROM workers
     WHERE status IN ('online', 'busy', 'draining', 'degraded', 'offline')
       AND last_heartbeat_at IS NOT NULL`,
  );

  let affected = 0;
  for (const worker of workers.rows) {
    const lastHeartbeat = new Date(worker.last_heartbeat_at as string | Date).getTime();
    const intervalMs = Number(worker.heartbeat_interval_seconds) * 1000;
    const elapsed = now.getTime() - lastHeartbeat;
    const offlineCutoffMs = intervalMs * context.config.WORKER_OFFLINE_THRESHOLD_MULTIPLIER;
    const degradedCutoffMs = intervalMs * context.config.WORKER_DEGRADED_THRESHOLD_MULTIPLIER;

    if (elapsed >= offlineCutoffMs) {
      if (worker.status !== 'offline') {
        await context.pool.query(`UPDATE workers SET status = 'offline' WHERE tenant_id = $1 AND id = $2`, [
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
            reassignment_grace_period_ms: context.config.WORKER_OFFLINE_GRACE_PERIOD_MS,
          },
        });
        affected += 1;
      }

      const graceElapsed = elapsed - offlineCutoffMs;
      if (graceElapsed >= context.config.WORKER_OFFLINE_GRACE_PERIOD_MS) {
        const reassigned = await context.pool.query(
          `UPDATE tasks
           SET state = 'ready',
               state_changed_at = now(),
               assigned_worker_id = NULL,
               assigned_agent_id = NULL,
               claimed_at = NULL,
               started_at = NULL
           WHERE tenant_id = $1 AND assigned_worker_id = $2 AND state IN ('claimed','running')
           RETURNING id`,
          [worker.tenant_id, worker.id],
        );

        if (reassigned.rowCount) {
          affected += reassigned.rowCount;
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
