import { createApiKey, type ApiKeyIdentity } from '../auth/api-key.js';
import { NotFoundError, ValidationError } from '../errors/domain-errors.js';
import type { WorkerServiceContext, RegisterWorkerInput } from './worker-service.js';

const WORKER_SECRET_REDACTION = 'redacted://worker-secret';
const secretLikeKeyPattern = /(secret|token|password|api[_-]?key|credential|authorization|private[_-]?key|known_hosts)/i;
const secretLikeValuePattern =
  /(?:^enc:v\d+:|^secret:|^redacted:\/\/|^Bearer\s+\S+|^sk-[A-Za-z0-9_-]+|^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/i;

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

  const agentsToCreate = input.agents ?? [];

  for (const agent of agentsToCreate) {
    const executionMode = agent.execution_mode ?? 'specialist';
    const agentMetadata = {
      ...(agent.metadata ?? {}),
      execution_mode: executionMode,
    };
    const capabilities = normalizeWorkerAgentCapabilities(
      agent.capabilities ?? [],
      executionMode,
    );
    const agentRes = await context.pool.query(
      `INSERT INTO agents (
        tenant_id, worker_id, name, capabilities, status, heartbeat_interval_seconds, last_heartbeat_at, metadata
      ) VALUES ($1,$2,$3,$4,'idle',$5,now(),$6)
      RETURNING id, name, capabilities`,
      [
        identity.tenantId,
        worker.id,
        agent.name,
        capabilities,
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

function normalizeWorkerAgentCapabilities(
  capabilities: string[],
  executionMode: 'specialist' | 'orchestrator' | 'hybrid',
): string[] {
  const values = new Set(capabilities.map((capability) => capability.trim()).filter(Boolean));
  if (executionMode === 'orchestrator' || executionMode === 'hybrid') {
    values.add('orchestrator');
  }
  return [...values];
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
  return res.rows.map((row) => sanitizeWorkerRow(row as Record<string, unknown>));
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
    metadata: sanitizeSecretLikeRecord(row.metadata),
    host_info: sanitizeSecretLikeRecord(row.host_info),
  } as T;
}

function sanitizeSecretLikeRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    sanitized[key] = sanitizeSecretLikeValue(entry, isSecretLikeKey(key));
  }
  return sanitized;
}

function sanitizeSecretLikeValue(value: unknown, inheritedSecret: boolean): unknown {
  if (typeof value === 'string') {
    return inheritedSecret || isSecretLikeValue(value) ? WORKER_SECRET_REDACTION : value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeSecretLikeValue(entry, inheritedSecret));
  }

  if (value && typeof value === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      sanitized[key] = sanitizeSecretLikeValue(nestedValue, inheritedSecret || isSecretLikeKey(key));
    }
    return sanitized;
  }

  return value;
}

function isSecretLikeKey(key: string): boolean {
  return secretLikeKeyPattern.test(key);
}

function isSecretLikeValue(value: string): boolean {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return false;
  }
  return secretLikeValuePattern.test(normalized);
}
