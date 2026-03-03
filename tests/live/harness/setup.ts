import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

import bcrypt from 'bcryptjs';
import pg from 'pg';

import { assertEvaluationConfig, loadConfig } from '../config.js';

import type { LiveContext, Provider, TemplateType } from './types.js';

interface SetupOptions {
  runId: string;
  provider: Provider;
  template: TemplateType;
  fastReset?: boolean;
}

interface SetupExecutionPlan {
  shouldRunDockerSetup: boolean;
  shouldWaitForHealth: boolean;
}

function getLiveConfig() {
  const liveConfig = loadConfig();
  assertEvaluationConfig(liveConfig);
  return liveConfig;
}

const DEFAULT_ADMIN_KEY_PREFIX = 'ab_admin_def';
const LIVE_RESET_EXCLUDED_TABLES = ['schema_migrations', 'tenants'] as const;

type TableNameRow = { tablename: string };

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function selectMutableLiveTables(tableNames: string[]): string[] {
  const excluded = new Set<string>(LIVE_RESET_EXCLUDED_TABLES);
  return tableNames
    .filter((tableName) => !excluded.has(tableName))
    .sort((left, right) => left.localeCompare(right));
}

export function buildLiveResetTruncateSql(tableNames: string[]): string | null {
  const mutableTables = selectMutableLiveTables(tableNames);
  if (mutableTables.length === 0) {
    return null;
  }

  return `TRUNCATE TABLE ${mutableTables.map(quoteIdentifier).join(', ')} RESTART IDENTITY CASCADE`;
}

function composeBinary(): string {
  try {
    execSync('docker compose version', { stdio: 'ignore' });
    return 'docker compose';
  } catch {
    // fall through
  }

  try {
    execSync('docker-compose version', { stdio: 'ignore' });
    return 'docker-compose';
  } catch {
    throw new Error('Neither `docker compose` nor `docker-compose` is available on PATH');
  }
}

function runDocker(command: string): void {
  execSync(command, { cwd: process.cwd(), stdio: 'inherit' });
}

async function waitForHealth(url: string, label: string, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  throw new Error(`Timed out waiting for ${label} at ${url}`);
}

function generateApiKey(scope: 'admin' | 'worker' | 'agent'): string {
  const randomPart = randomBytes(24).toString('base64url');
  return `ab_${scope}_${randomPart}`;
}

function ensureBootstrapAdminKey(): void {
  const existing = process.env.DEFAULT_ADMIN_API_KEY?.trim();
  if (existing && existing.length > 0) {
    if (!existing.startsWith(DEFAULT_ADMIN_KEY_PREFIX) || existing.length < 20) {
      throw new Error(
        `DEFAULT_ADMIN_API_KEY must start with ${DEFAULT_ADMIN_KEY_PREFIX} and be at least 20 chars for live harness bootstrap`,
      );
    }
    return;
  }

  const randomSuffix = randomBytes(18).toString('base64url');
  process.env.DEFAULT_ADMIN_API_KEY = `${DEFAULT_ADMIN_KEY_PREFIX}${randomSuffix}`;
}

async function insertApiKey(
  pool: pg.Pool,
  apiKey: string,
  scope: 'admin' | 'worker' | 'agent',
  ownerType: string,
  ownerId?: string,
): Promise<void> {
  const keyHash = await bcrypt.hash(apiKey, 12);
  const keyPrefix = apiKey.slice(0, 12);
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

  await pool.query(
    `INSERT INTO api_keys (tenant_id, key_hash, key_prefix, scope, owner_type, owner_id, label, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      '00000000-0000-0000-0000-000000000001',
      keyHash,
      keyPrefix,
      scope,
      ownerType,
      ownerId ?? null,
      `live-${scope}`,
      expiresAt,
    ],
  );
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`${url} -> ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload as T;
}

async function registerWorker(apiBaseUrl: string, workerKey: string): Promise<string> {
  const payload = await requestJson<{ data: { worker_id: string } }>(
    `${apiBaseUrl}/api/v1/workers/register`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${workerKey}` },
      body: JSON.stringify({
        name: 'live-suite-worker',
        runtime_type: 'external',
        connection_mode: 'polling',
        capabilities: ['code', 'test', 'review', 'analysis', 'docs'],
      }),
    },
  );

  return payload.data.worker_id;
}

async function registerAgent(apiBaseUrl: string, agentKey: string, workerId: string): Promise<string> {
  const payload = await requestJson<{ data: { id: string } }>(
    `${apiBaseUrl}/api/v1/agents/register`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${agentKey}` },
      body: JSON.stringify({
        name: 'live-suite-agent',
        capabilities: ['code', 'test', 'review', 'analysis', 'docs'],
        worker_id: workerId,
      }),
    },
  );

  return payload.data.id;
}

async function resetLiveState(postgresUrl: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: postgresUrl });
  try {
    await pool.query('BEGIN');

    const tableRows = await pool.query<TableNameRow>(
      `SELECT tablename
         FROM pg_tables
        WHERE schemaname = 'public'`,
    );

    const truncateSql = buildLiveResetTruncateSql(tableRows.rows.map((row) => row.tablename));
    if (truncateSql) {
      await pool.query(truncateSql);
    }

    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  } finally {
    await pool.end();
  }
}

async function seedDatabase(apiBaseUrl: string, postgresUrl: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: postgresUrl });
  try {
    const adminKey = generateApiKey('admin');
    const workerKey = generateApiKey('worker');
    const agentKey = generateApiKey('agent');

    await insertApiKey(pool, adminKey, 'admin', 'user');
    await insertApiKey(pool, workerKey, 'worker', 'worker-bootstrap');
    await insertApiKey(pool, agentKey, 'agent', 'agent-bootstrap');

    const workerId = await registerWorker(apiBaseUrl, workerKey);
    const agentId = await registerAgent(apiBaseUrl, agentKey, workerId);

    process.env.LIVE_ADMIN_KEY = adminKey;
    process.env.LIVE_WORKER_KEY = workerKey;
    process.env.LIVE_AGENT_KEY = agentKey;
    process.env.LIVE_WORKER_ID = workerId;
    process.env.LIVE_AGENT_ID = agentId;
  } finally {
    await pool.end();
  }
}

export async function verifyStrictPreflight(apiBaseUrl: string, adminKey: string): Promise<void> {
  await requestJson(`${apiBaseUrl}/api/v1/workers`, {
    headers: { authorization: `Bearer ${adminKey}` },
  });
}

export function createSetupExecutionPlan(skipStackSetup: boolean): SetupExecutionPlan {
  if (skipStackSetup) {
    return {
      shouldRunDockerSetup: false,
      shouldWaitForHealth: false,
    };
  }

  return {
    shouldRunDockerSetup: true,
    shouldWaitForHealth: true,
  };
}

export async function setupLiveEnvironment(options: SetupOptions): Promise<LiveContext> {
  const liveConfig = getLiveConfig();
  const apiBaseUrl = liveConfig.apiBaseUrl;
  const dashboardBaseUrl = liveConfig.dashboardBaseUrl;
  const postgresUrl = liveConfig.postgresUrl;

  const setupPlan = createSetupExecutionPlan(liveConfig.skipStackSetup);

  if (setupPlan.shouldRunDockerSetup) {
    ensureBootstrapAdminKey();
    runDocker(`${composeBinary()} up -d --build postgres platform-api worker dashboard`);
  }

  if (setupPlan.shouldWaitForHealth) {
    await waitForHealth(`${apiBaseUrl}/health`, 'platform-api health', liveConfig.healthTimeoutMs);
    await waitForHealth(`${dashboardBaseUrl}/`, 'dashboard', liveConfig.healthTimeoutMs);
  }

  if (options.fastReset) {
    await resetLiveState(postgresUrl);
  }

  await seedDatabase(apiBaseUrl, postgresUrl);
  await verifyStrictPreflight(apiBaseUrl, String(process.env.LIVE_ADMIN_KEY));

  return {
    runId: options.runId,
    provider: options.provider,
    template: options.template,
    reportDir: `${process.cwd()}/tests/artifacts/live`,
    screenshotDir: `${process.cwd()}/tests/artifacts/live/screenshots`,
    env: {
      apiBaseUrl,
      dashboardBaseUrl,
      postgresUrl,
    },
    keys: {
      admin: String(process.env.LIVE_ADMIN_KEY),
      worker: String(process.env.LIVE_WORKER_KEY),
      agent: String(process.env.LIVE_AGENT_KEY),
    },
    ids: {
      workerId: String(process.env.LIVE_WORKER_ID),
      agentId: String(process.env.LIVE_AGENT_ID),
    },
  };
}
