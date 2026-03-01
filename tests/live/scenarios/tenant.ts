/**
 * Per-test tenant isolation utilities.
 *
 * Each test scenario creates its own tenant with fresh API keys,
 * ensuring complete data isolation between concurrent or sequential runs.
 * Cleanup removes all created resources.
 */

import { randomBytes, randomUUID } from 'node:crypto';

import bcrypt from 'bcryptjs';
import pg from 'pg';

import { LiveApiClient } from '../api-client.js';
import { loadConfig } from '../config.js';

const config = loadConfig();

const DEFAULT_WORKER_CAPABILITIES = [
  'llm-api',
  'role:architect',
  'role:developer',
  'role:reviewer',
  'role:qa',
  'lang:typescript',
  'lang:python',
  'lang:go',
];

const DEFAULT_AGENT_CAPABILITIES = [
  'llm-api',
  'role:architect',
  'role:developer',
  'role:reviewer',
  'role:qa',
];

export interface WorkerAgentContext {
  /** Registered worker ID */
  workerId: string;
  /** Worker-scoped API key bound to workerId */
  workerKey: string;
  /** Client authenticated with workerKey */
  workerClient: LiveApiClient;
  /** Registered agent ID */
  agentId: string;
  /** Agent-scoped API key bound to agentId */
  agentKey: string;
  /** Client authenticated with agentKey */
  agentClient: LiveApiClient;
}

export interface TenantBootstrapContext {
  /** Unique tenant ID (UUID) */
  tenantId: string;
  /** Admin-scoped API key */
  adminKey: string;
  /** Bootstrap worker-scoped API key used to register workers */
  workerBootstrapKey: string;
  /** Bootstrap agent-scoped API key used to register agents */
  agentBootstrapKey: string;
  /** Admin client for tenant-scoped control operations */
  adminClient: LiveApiClient;
  /** Worker bootstrap client (scope: worker) */
  workerBootstrapClient: LiveApiClient;
  /** Agent bootstrap client (scope: agent) */
  agentBootstrapClient: LiveApiClient;
  /** Cleanup function — call in afterEach/afterAll */
  cleanup: () => Promise<void>;
}

export interface RegisterWorkerAgentInput {
  workerName: string;
  workerCapabilities: string[];
  agentName: string;
  agentCapabilities: string[];
  connectionMode?: 'polling' | 'websocket' | 'sse';
  runtimeType?: 'internal' | 'openclaw' | 'claude_code' | 'codex' | 'acp' | 'custom' | 'external';
}

export interface TenantContext {
  /** Unique tenant ID (UUID) */
  tenantId: string;
  /** Admin-scoped API key */
  adminKey: string;
  /** Worker-scoped API key */
  workerKey: string;
  /** Agent-scoped API key */
  agentKey: string;
  /** Pre-configured API client with admin key */
  adminClient: LiveApiClient;
  /** Pre-configured API client with worker key */
  workerClient: LiveApiClient;
  /** Pre-configured API client with agent key */
  agentClient: LiveApiClient;
  /** Registered worker ID */
  workerId: string;
  /** Registered agent ID */
  agentId: string;
  /** Cleanup function — call in afterEach/afterAll */
  cleanup: () => Promise<void>;
}

function generateApiKey(scope: string): string {
  const randomPart = randomBytes(24).toString('base64url');
  return `ab_${scope}_${randomPart}`;
}

async function insertApiKey(
  pool: pg.Pool,
  tenantId: string,
  apiKey: string,
  scope: string,
  ownerType: string,
): Promise<void> {
  const keyHash = await bcrypt.hash(apiKey, 10);
  const keyPrefix = apiKey.slice(0, 12);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await pool.query(
    `INSERT INTO api_keys (tenant_id, key_hash, key_prefix, scope, owner_type, label, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [tenantId, keyHash, keyPrefix, scope, ownerType, `live-${scope}`, expiresAt],
  );
}

function createCleanup(tenantId: string): () => Promise<void> {
  return async (): Promise<void> => {
    const cleanupPool = new pg.Pool({ connectionString: config.postgresUrl });
    try {
      // Cascade delete all tenant data
      await cleanupPool.query('DELETE FROM events WHERE tenant_id = $1', [tenantId]);
      await cleanupPool.query('DELETE FROM tasks WHERE tenant_id = $1', [tenantId]);
      await cleanupPool.query('DELETE FROM pipelines WHERE tenant_id = $1', [tenantId]);
      await cleanupPool.query('DELETE FROM templates WHERE tenant_id = $1', [tenantId]);
      await cleanupPool.query('DELETE FROM agents WHERE tenant_id = $1', [tenantId]);
      await cleanupPool.query('DELETE FROM workers WHERE tenant_id = $1', [tenantId]);
      await cleanupPool.query('DELETE FROM api_keys WHERE tenant_id = $1', [tenantId]);
      await cleanupPool.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
    } catch {
      // Best-effort cleanup
    } finally {
      await cleanupPool.end();
    }
  };
}

/**
 * Creates an isolated tenant with bootstrap admin/worker/agent API keys.
 *
 * This does NOT register any worker or agent identities by default.
 * Use registerWorkerAgent(...) for explicit worker/agent provisioning.
 */
export async function createTenantBootstrap(label: string): Promise<TenantBootstrapContext> {
  const pool = new pg.Pool({ connectionString: config.postgresUrl });
  const tenantId = randomUUID();
  const adminKey = generateApiKey('admin');
  const workerBootstrapKey = generateApiKey('worker');
  const agentBootstrapKey = generateApiKey('agent');

  try {
    await pool.query(`INSERT INTO tenants (id, name, slug, is_active) VALUES ($1, $2, $3, true)`, [
      tenantId,
      `live-${label}`,
      `live-${label}-${tenantId.slice(0, 8)}`,
    ]);

    await insertApiKey(pool, tenantId, adminKey, 'admin', 'user');
    await insertApiKey(pool, tenantId, workerBootstrapKey, 'worker', 'worker-bootstrap');
    await insertApiKey(pool, tenantId, agentBootstrapKey, 'agent', 'agent-bootstrap');
  } finally {
    await pool.end();
  }

  return {
    tenantId,
    adminKey,
    workerBootstrapKey,
    agentBootstrapKey,
    adminClient: new LiveApiClient(config.apiBaseUrl, adminKey),
    workerBootstrapClient: new LiveApiClient(config.apiBaseUrl, workerBootstrapKey),
    agentBootstrapClient: new LiveApiClient(config.apiBaseUrl, agentBootstrapKey),
    cleanup: createCleanup(tenantId),
  };
}

/**
 * Registers a worker + agent pair under a bootstrap tenant context and
 * returns worker-scoped and agent-scoped clients for task lifecycle calls.
 */
export async function registerWorkerAgent(
  tenant: TenantBootstrapContext,
  input: RegisterWorkerAgentInput,
): Promise<WorkerAgentContext> {
  const workerReg = await tenant.workerBootstrapClient.registerWorker({
    name: input.workerName,
    capabilities: input.workerCapabilities,
    connection_mode: input.connectionMode ?? 'polling',
    runtime_type: input.runtimeType ?? 'external',
  });

  const workerId = workerReg.worker_id ?? workerReg.id;
  if (!workerId) {
    const workerSummary = {
      id: workerReg.worker_id ?? workerReg.id,
      name: workerReg.name,
      status: workerReg.status,
    };
    throw new Error(`Worker registration did not return an id: ${JSON.stringify(workerSummary)}`);
  }

  if (!workerReg.worker_api_key) {
    throw new Error('Worker registration did not return a worker API key');
  }

  const workerClient = new LiveApiClient(config.apiBaseUrl, workerReg.worker_api_key);

  const agentReg = await tenant.agentBootstrapClient.registerAgent({
    name: input.agentName,
    capabilities: input.agentCapabilities,
    worker_id: workerId,
  });

  if (!agentReg.api_key) {
    throw new Error('Agent registration did not return an API key');
  }

  return {
    workerId,
    workerKey: workerReg.worker_api_key,
    workerClient,
    agentId: agentReg.id,
    agentKey: agentReg.api_key,
    agentClient: new LiveApiClient(config.apiBaseUrl, agentReg.api_key),
  };
}

/**
 * Creates a fresh tenant with admin, worker, and agent API keys.
 * Registers a default external worker+agent pair ready for task claiming.
 *
 * @param label - Human-readable label for the tenant (used in naming)
 */
export async function createTestTenant(label: string): Promise<TenantContext> {
  const tenant = await createTenantBootstrap(label);

  const pair = await registerWorkerAgent(tenant, {
    workerName: `live-worker-${label}`,
    workerCapabilities: DEFAULT_WORKER_CAPABILITIES,
    agentName: `live-agent-${label}`,
    agentCapabilities: DEFAULT_AGENT_CAPABILITIES,
    connectionMode: 'polling',
    runtimeType: 'external',
  });

  return {
    tenantId: tenant.tenantId,
    adminKey: tenant.adminKey,
    workerKey: pair.workerKey,
    agentKey: pair.agentKey,
    adminClient: tenant.adminClient,
    workerClient: pair.workerClient,
    agentClient: pair.agentClient,
    workerId: pair.workerId,
    agentId: pair.agentId,
    cleanup: tenant.cleanup,
  };
}
