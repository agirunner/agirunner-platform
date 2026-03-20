import { createApiKey, type ApiKeyIdentity } from '../auth/api-key.js';
import { NotFoundError, ValidationError } from '../errors/domain-errors.js';
import { sanitizeSecretLikeRecord } from './secret-redaction.js';
import type { WorkerServiceContext, RegisterWorkerInput } from './worker-service.js';

const WORKER_SECRET_REDACTION = 'redacted://worker-secret';
const WORKER_REDACTION_OPTIONS = { redactionValue: WORKER_SECRET_REDACTION, allowSecretReferences: false };

export async function registerWorker(
  context: WorkerServiceContext,
  identity: ApiKeyIdentity,
  input: RegisterWorkerInput,
) {
  if (!input.name?.trim()) {
    throw new ValidationError('worker name is required');
  }

  const workerKeyExpiryMs = requireRuntimeDefaultNumber(
    context.config.WORKER_API_KEY_TTL_MS,
    'platform.worker_key_expiry_ms',
  );
  const agentKeyExpiryMs = requireRuntimeDefaultNumber(
    context.config.AGENT_API_KEY_TTL_MS,
    'platform.agent_key_expiry_ms',
  );

  const workerRes = await context.pool.query(
    `INSERT INTO workers (
      tenant_id, name, status, connection_mode, runtime_type, routing_tags,
      host_info, heartbeat_interval_seconds, last_heartbeat_at, connected_at, metadata
    ) VALUES ($1,$2,'online',$3,$4,$5,$6,$7,now(),now(),$8)
    RETURNING *`,
    [
      identity.tenantId,
      input.name,
      input.connection_mode ?? 'websocket',
      input.runtime_type ?? 'external',
      input.routing_tags ?? [],
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
    expiresAt: new Date(Date.now() + workerKeyExpiryMs),
  });

  const createdAgents: Array<{ id: string; name: string; api_key: string; routing_tags: string[] }> = [];

  const agentsToCreate = input.agents ?? [];

  for (const agent of agentsToCreate) {
    const executionMode = agent.execution_mode ?? 'specialist';
    const agentMetadata = {
      ...(agent.metadata ?? {}),
      execution_mode: executionMode,
    };
    const routingTags = normalizeWorkerAgentRoutingTags(agent.routing_tags ?? [], executionMode);
    const agentRes = await context.pool.query(
      `INSERT INTO agents (
        tenant_id, worker_id, name, routing_tags, status, heartbeat_interval_seconds, last_heartbeat_at, metadata
      ) VALUES ($1,$2,$3,$4,'idle',$5,now(),$6)
      RETURNING id, name, routing_tags`,
      [
        identity.tenantId,
        worker.id,
        agent.name,
        routingTags,
        input.heartbeat_interval_seconds ?? context.config.WORKER_DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
        agentMetadata,
      ],
    );

    const agentRow = agentRes.rows[0];
    const agentKeyResult = await createApiKey(context.pool, {
      tenantId: identity.tenantId,
      scope: 'agent',
      ownerType: 'agent',
      ownerId: agentRow.id,
      label: `agent:${agentRow.name}`,
      expiresAt: new Date(Date.now() + agentKeyExpiryMs),
    });

    createdAgents.push({
      id: agentRow.id,
      name: agentRow.name,
      routing_tags: agentRow.routing_tags,
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

function normalizeWorkerAgentRoutingTags(
  routingTags: string[],
  executionMode: 'specialist' | 'orchestrator' | 'hybrid',
): string[] {
  const values = new Set(routingTags.map((routingTag) => routingTag.trim()).filter(Boolean));
  if (executionMode === 'orchestrator' || executionMode === 'hybrid') {
    values.add('orchestrator');
  }
  return [...values];
}

function requireRuntimeDefaultNumber(value: number | undefined, runtimeKey: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    throw new ValidationError(`Missing runtime default "${runtimeKey}"`);
  }
  return value;
}

export async function listWorkers(context: WorkerServiceContext, tenantId: string) {
  const res = await context.pool.query(
    `SELECT id, name, status, connection_mode, runtime_type, routing_tags, current_task_id,
            heartbeat_interval_seconds, last_heartbeat_at, connected_at, metadata, host_info,
            created_at, updated_at
     FROM workers
     WHERE tenant_id = $1
     ORDER BY created_at DESC`,
    [tenantId],
  );
  return res.rows.map((row) => sanitizeWorkerRow(row as Record<string, unknown>));
}

export async function getWorker(context: WorkerServiceContext, tenantId: string, workerId: string) {
  const res = await context.pool.query(
    `SELECT id, name, status, connection_mode, runtime_type, routing_tags, current_task_id,
            heartbeat_interval_seconds, last_heartbeat_at, connected_at, metadata, host_info,
            created_at, updated_at
     FROM workers
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, workerId],
  );
  if (!res.rowCount) {
    throw new NotFoundError('Worker not found');
  }
  return sanitizeWorkerRow(res.rows[0] as Record<string, unknown>);
}

export async function deleteWorker(context: WorkerServiceContext, identity: ApiKeyIdentity, workerId: string): Promise<void> {
  const worker = await getWorker(context, identity.tenantId, workerId);

  // Keep agent identities, but detach them from this worker before deletion
  // to satisfy FK constraints on agents.worker_id.
  await context.pool.query('UPDATE agents SET worker_id = NULL WHERE tenant_id = $1 AND worker_id = $2', [
    identity.tenantId,
    workerId,
  ]);

  // Tasks keep historical assignment metadata, so we null the live FK before deleting
  // the worker row to avoid tasks.assigned_worker_id FK violations.
  await context.pool.query('UPDATE tasks SET assigned_worker_id = NULL WHERE tenant_id = $1 AND assigned_worker_id = $2', [
    identity.tenantId,
    workerId,
  ]);

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

function sanitizeWorkerRow<T extends Record<string, unknown>>(row: T): T {
  return {
    ...row,
    metadata: sanitizeSecretLikeRecord(row.metadata, WORKER_REDACTION_OPTIONS),
    host_info: sanitizeSecretLikeRecord(row.host_info, WORKER_REDACTION_OPTIONS),
  } as T;
}
