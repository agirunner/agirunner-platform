import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { WorkerSignalInput, WorkerServiceContext } from './worker-service.js';
import { getWorker } from './worker-registration-service.js';
import { ensureWorkerAccess } from './worker-heartbeat-service.js';

export async function sendSignal(
  context: WorkerServiceContext,
  identity: ApiKeyIdentity,
  workerId: string,
  input: WorkerSignalInput,
) {
  await getWorker(context, identity.tenantId, workerId);

  const signalType =
    input.type === 'cancel' ? 'cancel_task' : input.type === 'drain' ? 'set_draining' : 'config_update';

  const signalRes = await context.pool.query(
    `INSERT INTO worker_signals (tenant_id, worker_id, signal_type, task_id, data)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id, created_at`,
    [identity.tenantId, workerId, signalType, input.task_id ?? null, input.data ?? {}],
  );

  context.connectionHub.sendToWorker(workerId, {
    type: 'worker.signal',
    signal_id: signalRes.rows[0].id,
    signal_type: signalType,
    task_id: input.task_id ?? null,
    data: input.data ?? {},
    issued_at: signalRes.rows[0].created_at,
  });

  await context.eventService.emit({
    tenantId: identity.tenantId,
    type: 'worker.signaled',
    entityType: 'worker',
    entityId: workerId,
    actorType: identity.scope,
    actorId: identity.keyPrefix,
    data: { signal_type: signalType, task_id: input.task_id ?? null },
  });

  return { signal_id: signalRes.rows[0].id };
}

export async function acknowledgeSignal(
  context: WorkerServiceContext,
  identity: ApiKeyIdentity,
  workerId: string,
  signalId: string,
): Promise<void> {
  ensureWorkerAccess(identity, workerId);
  await context.pool.query(
    'UPDATE worker_signals SET delivered = true WHERE tenant_id = $1 AND worker_id = $2 AND id = $3',
    [identity.tenantId, workerId, signalId],
  );
}
