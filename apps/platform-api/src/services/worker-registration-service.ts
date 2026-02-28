import { createApiKey, type ApiKeyIdentity } from '../auth/api-key.js';
import { NotFoundError, ValidationError } from '../errors/domain-errors.js';
import type { WorkerServiceContext, RegisterWorkerInput } from './worker-service.js';

export async function registerWorker(
  context: WorkerServiceContext,
  identity: ApiKeyIdentity,
  input: RegisterWorkerInput,
) {
  if (!input.name?.trim()) {
    throw new ValidationError('worker name is required');
  }

  const workerRes = await context.pool.query(
    `INSERT INTO workers (
      tenant_id, name, status, connection_mode, runtime_type, capabilities,
      host_info, heartbeat_interval_seconds, last_heartbeat_at, connected_at, metadata
    ) VALUES ($1,$2,'online',$3,$4,$5,$6,$7,now(),now(),$8)
    RETURNING *`,
    [
      identity.tenantId,
      input.name,
      input.connection_mode ?? 'websocket',
      input.runtime_type ?? 'external',
      input.capabilities ?? [],
      input.host_info ?? {},
      input.heartbeat_interval_seconds ?? context.config.WORKER_DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
      input.metadata ?? {},
    ],
  );

  const worker = workerRes.rows[0];
  const workerKeyResult = await createApiKey(context.pool, {
    tenantId: identity.tenantId,
    scope: 'worker',
    ownerType: 'worker',
    ownerId: worker.id,
    label: `worker:${worker.name}`,
    expiresAt: new Date(Date.now() + context.config.WORKER_API_KEY_TTL_MS),
  });

  const createdAgents: Array<{ id: string; name: string; api_key: string; capabilities: string[] }> = [];
  for (const agent of input.agents ?? []) {
    const agentRes = await context.pool.query(
      `INSERT INTO agents (
        tenant_id, worker_id, name, capabilities, status, heartbeat_interval_seconds, last_heartbeat_at, metadata
      ) VALUES ($1,$2,$3,$4,'idle',$5,now(),$6)
      RETURNING id, name, capabilities`,
      [
        identity.tenantId,
        worker.id,
        agent.name,
        agent.capabilities ?? [],
        input.heartbeat_interval_seconds ?? context.config.WORKER_DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
        agent.metadata ?? {},
      ],
    );

    const agentRow = agentRes.rows[0];
    const agentKeyResult = await createApiKey(context.pool, {
      tenantId: identity.tenantId,
      scope: 'agent',
      ownerType: 'agent',
      ownerId: agentRow.id,
      label: `agent:${agentRow.name}`,
      expiresAt: new Date(Date.now() + context.config.AGENT_API_KEY_TTL_MS),
    });

    createdAgents.push({
      id: agentRow.id,
      name: agentRow.name,
      capabilities: agentRow.capabilities,
      api_key: agentKeyResult.apiKey,
    });
  }

  await context.eventService.emit({
    tenantId: identity.tenantId,
    type: 'worker.registered',
    entityType: 'worker',
    entityId: worker.id,
    actorType: identity.scope,
    actorId: identity.keyPrefix,
    data: { name: worker.name },
  });

  return {
    worker_id: worker.id,
    worker_api_key: workerKeyResult.apiKey,
    agents: createdAgents,
    websocket_url: context.config.WORKER_WEBSOCKET_PATH,
    heartbeat_interval_seconds: worker.heartbeat_interval_seconds,
  };
}

export async function listWorkers(context: WorkerServiceContext, tenantId: string) {
  const res = await context.pool.query(
    `SELECT id, name, status, connection_mode, runtime_type, capabilities, current_task_id,
            heartbeat_interval_seconds, last_heartbeat_at, connected_at, metadata, host_info,
            created_at, updated_at
     FROM workers
     WHERE tenant_id = $1
     ORDER BY created_at DESC`,
    [tenantId],
  );
  return res.rows;
}

export async function getWorker(context: WorkerServiceContext, tenantId: string, workerId: string) {
  const res = await context.pool.query(
    `SELECT id, name, status, connection_mode, runtime_type, capabilities, current_task_id,
            heartbeat_interval_seconds, last_heartbeat_at, connected_at, metadata, host_info,
            created_at, updated_at
     FROM workers
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, workerId],
  );
  if (!res.rowCount) {
    throw new NotFoundError('Worker not found');
  }
  return res.rows[0];
}

export async function deleteWorker(context: WorkerServiceContext, identity: ApiKeyIdentity, workerId: string): Promise<void> {
  const worker = await getWorker(context, identity.tenantId, workerId);

  await context.pool.query('DELETE FROM api_keys WHERE tenant_id = $1 AND owner_type = $2 AND owner_id = $3', [
    identity.tenantId,
    'worker',
    workerId,
  ]);
  await context.pool.query('DELETE FROM workers WHERE tenant_id = $1 AND id = $2', [identity.tenantId, workerId]);
  context.connectionHub.unregisterWorker(workerId);

  await context.eventService.emit({
    tenantId: identity.tenantId,
    type: 'worker.deregistered',
    entityType: 'worker',
    entityId: workerId,
    actorType: identity.scope,
    actorId: identity.keyPrefix,
    data: { name: worker.name },
  });
}
