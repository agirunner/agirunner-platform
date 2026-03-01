/**
 * Per-test tenant isolation utilities.
 *
 * Each test scenario creates its own tenant with fresh API keys,
 * ensuring complete data isolation between concurrent or sequential runs.
 * Cleanup removes all created resources.
 */

import { randomBytes } from 'node:crypto';

import bcrypt from 'bcryptjs';
import pg from 'pg';

import { LiveApiClient } from '../api-client.js';
import { loadConfig } from '../config.js';

const config = loadConfig();

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

/**
 * Creates a fresh tenant with admin, worker, and agent API keys.
 * Registers a worker and agent ready for task claiming.
 *
 * @param label - Human-readable label for the tenant (used in naming)
 */
export async function createTestTenant(label: string): Promise<TenantContext> {
  const pool = new pg.Pool({ connectionString: config.postgresUrl });
  const tenantId = crypto.randomUUID();
  const adminKey = generateApiKey('admin');
  const workerKey = generateApiKey('worker');
  const agentKey = generateApiKey('agent');

  try {
    // Create tenant row
    await pool.query(
      `INSERT INTO tenants (id, name, slug, is_active) VALUES ($1, $2, $3, true)`,
      [tenantId, `live-${label}`, `live-${label}-${tenantId.slice(0, 8)}`],
    );

    // Insert API keys
    await insertApiKey(pool, tenantId, adminKey, 'admin', 'user');
    await insertApiKey(pool, tenantId, workerKey, 'worker', 'worker-bootstrap');
    await insertApiKey(pool, tenantId, agentKey, 'agent', 'agent-bootstrap');
  } finally {
    await pool.end();
  }

  const adminClient = new LiveApiClient(config.apiBaseUrl, adminKey);
  const bootstrapWorkerClient = new LiveApiClient(config.apiBaseUrl, workerKey);
  const bootstrapAgentClient = new LiveApiClient(config.apiBaseUrl, agentKey);

  // Register worker and switch to the worker-scoped key bound to that worker id.
  const workerReg = await bootstrapWorkerClient.registerWorker({
    name: `live-worker-${label}`,
    capabilities: [
      'llm-api',
      'role:architect',
      'role:developer',
      'role:reviewer',
      'role:qa',
      'lang:typescript',
      'lang:python',
      'lang:go',
    ],
    connection_mode: 'polling',
    runtime_type: 'external',
  });

  const registeredWorkerId = workerReg.worker_id ?? workerReg.id;
  if (!registeredWorkerId) {
    const workerSummary = {
      id: workerReg.worker_id ?? workerReg.id,
      name: workerReg.name,
      status: workerReg.status,
    };
    throw new Error(`Worker registration did not return an id: ${JSON.stringify(workerSummary)}`);
  }

  if (!workerReg.worker_api_key) {
    throw new Error('Worker registration did not return worker_api_key');
  }

  const scopedWorkerClient = new LiveApiClient(config.apiBaseUrl, workerReg.worker_api_key);

  // Register agent and switch to the agent-scoped key bound to that agent id.
  const agentReg = await bootstrapAgentClient.registerAgent({
    name: `live-agent-${label}`,
    capabilities: [
      'llm-api',
      'role:architect',
      'role:developer',
      'role:reviewer',
      'role:qa',
    ],
    worker_id: registeredWorkerId,
  });

  if (!agentReg.api_key) {
    throw new Error('Agent registration did not return api_key');
  }

  const scopedAgentClient = new LiveApiClient(config.apiBaseUrl, agentReg.api_key);

  const cleanup = async (): Promise<void> => {
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

  return {
    tenantId,
    adminKey,
    workerKey: workerReg.worker_api_key,
    agentKey: agentReg.api_key,
    adminClient,
    workerClient: scopedWorkerClient,
    agentClient: scopedAgentClient,
    workerId: registeredWorkerId,
    agentId: agentReg.id,
    cleanup,
  };
}
