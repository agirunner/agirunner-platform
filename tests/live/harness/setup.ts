import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

import bcrypt from 'bcryptjs';
import pg from 'pg';

import { loadConfig } from '../config.js';

import type { LiveContext, Provider, TemplateType } from './types.js';

interface SetupOptions {
  runId: string;
  provider: Provider;
  template: TemplateType;
}

interface SetupExecutionPlan {
  shouldRunDockerSetup: boolean;
  shouldWaitForHealth: boolean;
}

const liveConfig = loadConfig();

const API_BASE_URL = liveConfig.apiBaseUrl;
const DASHBOARD_BASE_URL = liveConfig.dashboardBaseUrl;
const POSTGRES_URL = liveConfig.postgresUrl;

const DEFAULT_ADMIN_KEY_PREFIX = 'ab_admin_def';

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

async function waitForHealth(
  url: string,
  label: string,
  timeoutMs = liveConfig.healthTimeoutMs,
): Promise<void> {
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

async function registerWorker(workerKey: string): Promise<string> {
  const payload = await requestJson<{ data: { worker_id: string } }>(
    `${API_BASE_URL}/api/v1/workers/register`,
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

async function registerAgent(agentKey: string, workerId: string): Promise<string> {
  const payload = await requestJson<{ data: { id: string } }>(
    `${API_BASE_URL}/api/v1/agents/register`,
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

async function seedDatabase(): Promise<void> {
  const pool = new pg.Pool({ connectionString: POSTGRES_URL });
  try {
    const adminKey = generateApiKey('admin');
    const workerKey = generateApiKey('worker');
    const agentKey = generateApiKey('agent');

    await insertApiKey(pool, adminKey, 'admin', 'user');
    await insertApiKey(pool, workerKey, 'worker', 'worker-bootstrap');
    await insertApiKey(pool, agentKey, 'agent', 'agent-bootstrap');

    const workerId = await registerWorker(workerKey);
    const agentId = await registerAgent(agentKey, workerId);

    process.env.LIVE_ADMIN_KEY = adminKey;
    process.env.LIVE_WORKER_KEY = workerKey;
    process.env.LIVE_AGENT_KEY = agentKey;
    process.env.LIVE_WORKER_ID = workerId;
    process.env.LIVE_AGENT_ID = agentId;
  } finally {
    await pool.end();
  }
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
  const setupPlan = createSetupExecutionPlan(liveConfig.skipStackSetup);

  if (setupPlan.shouldRunDockerSetup) {
    ensureBootstrapAdminKey();
    runDocker(`${composeBinary()} up -d --build postgres platform-api worker dashboard`);
  }

  if (setupPlan.shouldWaitForHealth) {
    await waitForHealth(`${API_BASE_URL}/health`, 'platform-api health');
    await waitForHealth(`${DASHBOARD_BASE_URL}/`, 'dashboard');
  }

  await seedDatabase();

  return {
    runId: options.runId,
    provider: options.provider,
    template: options.template,
    reportDir: `${process.cwd()}/tests/live/reports`,
    screenshotDir: `${process.cwd()}/tests/live/reports/screenshots`,
    env: {
      apiBaseUrl: API_BASE_URL,
      dashboardBaseUrl: DASHBOARD_BASE_URL,
      postgresUrl: POSTGRES_URL,
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
