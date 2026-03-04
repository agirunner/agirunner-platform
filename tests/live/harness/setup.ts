import { execSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

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
  shouldBuildImages: boolean;
  buildFingerprint?: BuildFingerprint;
}

interface BuildFingerprint {
  key: string;
  source: 'git-commit' | 'workspace-fingerprint';
  gitCommit?: string;
}

interface BuildFingerprintCacheRecord {
  fingerprint: string;
  source: BuildFingerprint['source'];
  gitCommit?: string;
  updatedAt: string;
}

const FINGERPRINT_EXCLUDED_TRACKED_PATHS = ['tests/reports/results.v1.json'];

function getLiveConfig() {
  const liveConfig = loadConfig();
  assertEvaluationConfig(liveConfig);
  return liveConfig;
}

const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';
const DEFAULT_ADMIN_KEY_PREFIX = 'ab_admin_def';
const DEFAULT_ADMIN_API_KEY_ENV = 'DEFAULT_ADMIN_API_KEY';
const DEFAULT_ADMIN_KEY_EXPIRY = new Date('2099-12-31T23:59:59Z');
const LIVE_RESET_EXCLUDED_TABLES = ['schema_migrations', 'tenants'] as const;
const REQUIRED_STARTUP_SECRETS: ReadonlyArray<{
  envVar: 'JWT_SECRET' | 'WEBHOOK_ENCRYPTION_KEY';
  minLength: number;
}> = [
  { envVar: 'JWT_SECRET', minLength: 32 },
  { envVar: 'WEBHOOK_ENCRYPTION_KEY', minLength: 32 },
];
function resolveBuildCachePath(): string {
  const override = process.env.LIVE_BUILD_CACHE_PATH?.trim();
  if (override) {
    return path.isAbsolute(override) ? override : path.join(process.cwd(), override);
  }

  return path.join(process.cwd(), '.cache', 'live-harness', 'compose-build-fingerprint.v1.json');
}

type TableNameRow = { tablename: string };

type ExistingDefaultAdminKeyRow = { key_hash: string };

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

export function parseDfAvailableKilobytes(dfOutput: string): number | null {
  const lines = dfOutput
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return null;
  }

  const dataLine = lines[lines.length - 1];
  const columns = dataLine.split(/\s+/);
  if (columns.length < 4) {
    return null;
  }

  const available = Number(columns[3]);
  if (!Number.isFinite(available) || available < 0) {
    return null;
  }

  return available;
}

export function assertComposeDiskFloorFromAvailableKilobytes(
  availableKilobytes: number,
  rootPath = '/',
  minFreeGiB = 10,
): void {
  if (!Number.isFinite(availableKilobytes) || availableKilobytes < 0) {
    throw new Error(
      'Live harness compose preflight failed: unable to parse free disk space from `df -Pk` output.',
    );
  }

  const minFreeKilobytes = Math.floor(minFreeGiB * 1024 * 1024);
  if (availableKilobytes < minFreeKilobytes) {
    const availableGiB = (availableKilobytes / (1024 * 1024)).toFixed(2);
    throw new Error(
      `Live harness compose preflight failed: free disk on ${rootPath} is ${availableGiB}GiB, below required floor ${minFreeGiB}GiB. ` +
        'Free space before running compose build/up.',
    );
  }
}

export function assertComposeDiskFloor(rootPath = '/', minFreeGiB = 10): void {
  const output = execSync(`df -Pk ${rootPath}`, {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'ignore'],
    encoding: 'utf8',
  });

  const availableKilobytes = parseDfAvailableKilobytes(output);
  if (availableKilobytes === null) {
    throw new Error(
      'Live harness compose preflight failed: unable to parse free disk space from `df -Pk` output.',
    );
  }

  assertComposeDiskFloorFromAvailableKilobytes(availableKilobytes, rootPath, minFreeGiB);
}

export function resolveComposeMinFreeGiB(
  source: NodeJS.ProcessEnv = process.env,
  defaultMinFreeGiB = 10,
): number {
  const raw = source.LIVE_COMPOSE_MIN_FREE_GB;
  if (!raw || raw.trim().length === 0) {
    return defaultMinFreeGiB;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `Live harness compose preflight failed: LIVE_COMPOSE_MIN_FREE_GB must be a positive numeric value in GiB (received: ${JSON.stringify(
        raw,
      )}).`,
    );
  }

  return parsed;
}

function runCommandQuiet(command: string): string | null {
  try {
    return execSync(command, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();
  } catch {
    return null;
  }
}

function parseBooleanEnv(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function hashText(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function trackedFingerprintPathspecArgs(): string {
  const exclusions = FINGERPRINT_EXCLUDED_TRACKED_PATHS.map((value) => `':(exclude)${value}'`).join(
    ' ',
  );
  return exclusions.length > 0 ? `. ${exclusions}` : '.';
}

function hasTrackedChangesAffectingFingerprint(): boolean {
  const pathspec = trackedFingerprintPathspecArgs();
  const trackedDiff = runCommandQuiet(`git diff --name-only HEAD -- ${pathspec}`) ?? '';
  if (trackedDiff.length > 0) {
    return true;
  }

  const stagedDiff = runCommandQuiet(`git diff --cached --name-only -- ${pathspec}`) ?? '';
  return stagedDiff.length > 0;
}

function isTransientUntrackedPath(filePath: string): boolean {
  const normalized = filePath.replaceAll('\\', '/');
  return (
    normalized.startsWith('tests/artifacts/') ||
    normalized.startsWith('.cache/live-harness/') ||
    normalized.startsWith('.turbo/')
  );
}

function resolveWorkspaceFingerprint(): BuildFingerprint {
  const gitCommit = runCommandQuiet('git rev-parse HEAD') ?? undefined;
  const trackedDirty = hasTrackedChangesAffectingFingerprint();
  const untrackedFingerprintInputs =
    runCommandQuiet('git ls-files --others --exclude-standard')
      ?.split('\n')
      .map((value) => value.trim())
      .filter((value) => value.length > 0 && !isTransientUntrackedPath(value))
      .sort((left, right) => left.localeCompare(right)) ?? [];

  if (gitCommit && !trackedDirty && untrackedFingerprintInputs.length === 0) {
    return {
      key: `commit:${gitCommit}`,
      source: 'git-commit',
      gitCommit,
    };
  }

  const hash = createHash('sha256');
  hash.update(`git-commit:${gitCommit ?? 'none'}\n`);

  const diff =
    runCommandQuiet(
      `git diff --no-ext-diff --binary HEAD -- ${trackedFingerprintPathspecArgs()}`,
    ) ?? '';
  hash.update('git-diff-start\n');
  hash.update(diff);
  hash.update('\ngit-diff-end\n');

  for (const filePath of untrackedFingerprintInputs) {
    hash.update(`untracked:${filePath}\n`);
    try {
      const absolutePath = path.join(process.cwd(), filePath);
      const content = readFileSync(absolutePath);
      hash.update(content);
    } catch {
      hash.update('untracked-read-error\n');
    }
    hash.update('\n');
  }

  const buildArgFingerprint = hashText(
    JSON.stringify({
      vitePlatformApiUrl: process.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080',
    }),
  );

  hash.update(`build-args:${buildArgFingerprint}\n`);

  return {
    key: `workspace:${hash.digest('hex')}`,
    source: 'workspace-fingerprint',
    gitCommit,
  };
}

function readBuildFingerprintCache(): BuildFingerprintCacheRecord | null {
  const buildCachePath = resolveBuildCachePath();
  if (!existsSync(buildCachePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(buildCachePath, 'utf8')) as BuildFingerprintCacheRecord;
    if (!parsed.fingerprint || !parsed.source) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function writeBuildFingerprintCache(fingerprint: BuildFingerprint): void {
  const buildCachePath = resolveBuildCachePath();
  mkdirSync(path.dirname(buildCachePath), { recursive: true });
  const record: BuildFingerprintCacheRecord = {
    fingerprint: fingerprint.key,
    source: fingerprint.source,
    gitCommit: fingerprint.gitCommit,
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(buildCachePath, JSON.stringify(record, null, 2) + '\n');
}

export function shouldBuildDockerImages(
  forceBuild: boolean,
  fingerprint: BuildFingerprint,
  previous: BuildFingerprintCacheRecord | null,
): boolean {
  if (forceBuild) {
    return true;
  }

  if (!previous) {
    return true;
  }

  return previous.fingerprint !== fingerprint.key;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isApiAuthReadinessStatus(status: number): boolean {
  return status === 401 || status === 403;
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
    await sleep(1500);
  }

  throw new Error(`Timed out waiting for ${label} at ${url}`);
}

async function waitForPostgresReady(postgresUrl: string, timeoutMs: number): Promise<void> {
  const started = Date.now();
  let lastError: string | undefined;

  while (Date.now() - started < timeoutMs) {
    const client = new pg.Client({ connectionString: postgresUrl });

    try {
      await client.connect();
      await client.query('SELECT 1');
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    } finally {
      try {
        await client.end();
      } catch {
        // ignore cleanup errors while probing readiness
      }
    }

    await sleep(1000);
  }

  throw new Error(
    `Timed out waiting for postgres readiness (${timeoutMs}ms)${lastError ? `: ${lastError}` : ''}`,
  );
}

async function waitForApiAuthReadiness(apiBaseUrl: string, timeoutMs: number): Promise<void> {
  const started = Date.now();
  let lastStatus: number | undefined;
  let lastError: string | undefined;

  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/tasks`);
      lastStatus = response.status;
      if (isApiAuthReadinessStatus(response.status)) {
        return;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await sleep(1000);
  }

  throw new Error(
    `Timed out waiting for API auth readiness at ${apiBaseUrl}/api/v1/tasks` +
      `${lastStatus !== undefined ? ` (last status=${lastStatus})` : ''}` +
      `${lastError ? `: ${lastError}` : ''}`,
  );
}

async function restartWarmFastResetServices(
  apiBaseUrl: string,
  postgresUrl: string,
  timeoutMs: number,
): Promise<void> {
  const composeCommand = composeBinary();

  runDocker(`${composeCommand} restart platform-api`);
  await waitForHealth(`${apiBaseUrl}/health`, 'platform-api health', timeoutMs);
  await waitForPostgresReady(postgresUrl, timeoutMs);
  await waitForApiAuthReadiness(apiBaseUrl, timeoutMs);

  runDocker(`${composeCommand} restart worker`);
}

function generateApiKey(scope: 'admin' | 'worker' | 'agent'): string {
  const randomPart = randomBytes(24).toString('base64url');
  return `ab_${scope}_${randomPart}`;
}

function validateDefaultAdminApiKey(key: string): string {
  const normalized = key.trim();
  if (!normalized.startsWith(DEFAULT_ADMIN_KEY_PREFIX) || normalized.length < 20) {
    throw new Error(
      `${DEFAULT_ADMIN_API_KEY_ENV} must start with ${DEFAULT_ADMIN_KEY_PREFIX} and be at least 20 chars for live harness bootstrap`,
    );
  }

  return normalized;
}

function getConfiguredDefaultAdminApiKey(source: NodeJS.ProcessEnv = process.env): string | null {
  const raw = source[DEFAULT_ADMIN_API_KEY_ENV];
  if (!raw || raw.trim().length === 0) {
    return null;
  }

  return validateDefaultAdminApiKey(raw);
}

function ensureBootstrapAdminKey(options: { allowGenerate?: boolean } = {}): string | null {
  const existing = getConfiguredDefaultAdminApiKey();
  if (existing) {
    return existing;
  }

  if (!options.allowGenerate) {
    return null;
  }

  const randomSuffix = randomBytes(18).toString('base64url');
  const generated = `${DEFAULT_ADMIN_KEY_PREFIX}${randomSuffix}`;
  process.env.DEFAULT_ADMIN_API_KEY = generated;
  return generated;
}

function ensureComposeRuntimeSecrets(): void {
  for (const secret of REQUIRED_STARTUP_SECRETS) {
    const configured = process.env[secret.envVar]?.trim();

    if (configured && configured.length >= secret.minLength) {
      continue;
    }

    if (configured && configured.length > 0 && configured.length < secret.minLength) {
      throw new Error(
        `${secret.envVar} must be at least ${secret.minLength} characters when provided to live harness docker setup`,
      );
    }

    process.env[secret.envVar] = randomBytes(secret.minLength).toString('hex');
  }
}

export function ensureDashboardCorsOrigin(
  dashboardBaseUrl: string,
  source: NodeJS.ProcessEnv = process.env,
): string {
  const configured = source.CORS_ORIGIN?.trim();
  if (configured) {
    return configured;
  }

  let origin: string;
  try {
    origin = new URL(dashboardBaseUrl).origin;
  } catch {
    throw new Error(`Invalid LIVE_DASHBOARD_BASE_URL for CORS origin derivation: ${dashboardBaseUrl}`);
  }

  source.CORS_ORIGIN = origin;
  return origin;
}

function captureBootstrapAdminKeyFromRunningStack(): string | null {
  const composeCommand = composeBinary();
  const lookups: ReadonlyArray<{ service: string; envVar: string }> = [
    { service: 'platform-api', envVar: DEFAULT_ADMIN_API_KEY_ENV },
    { service: 'worker', envVar: 'PLATFORM_API_KEY' },
  ];

  for (const lookup of lookups) {
    const containerId = runCommandQuiet(`${composeCommand} ps -q ${lookup.service}`);
    if (!containerId) {
      continue;
    }

    const envDump = runCommandQuiet(
      `docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' ${containerId}`,
    );
    if (!envDump) {
      continue;
    }

    const line = envDump
      .split('\n')
      .map((value) => value.trim())
      .find((value) => value.startsWith(`${lookup.envVar}=`));

    if (!line) {
      continue;
    }

    const [, value = ''] = line.split('=', 2);
    if (!value) {
      continue;
    }

    const key = validateDefaultAdminApiKey(value);
    process.env.DEFAULT_ADMIN_API_KEY = key;
    return key;
  }

  return null;
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
      DEFAULT_TENANT_ID,
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

async function ensureDefaultAdminApiKeyPersisted(pool: pg.Pool): Promise<string | null> {
  const defaultAdminApiKey = ensureBootstrapAdminKey({ allowGenerate: false });
  if (!defaultAdminApiKey) {
    return null;
  }

  const existing = await pool.query<ExistingDefaultAdminKeyRow>(
    `SELECT key_hash
       FROM api_keys
      WHERE tenant_id = $1 AND key_prefix = $2
      LIMIT 1`,
    [DEFAULT_TENANT_ID, DEFAULT_ADMIN_KEY_PREFIX],
  );

  if (existing.rowCount) {
    const matches = await bcrypt.compare(defaultAdminApiKey, existing.rows[0].key_hash);
    if (!matches) {
      throw new Error(
        `${DEFAULT_ADMIN_API_KEY_ENV} does not match the existing default admin key in the database. ` +
          'Use the original key or reset the database volume before changing it.',
      );
    }

    return defaultAdminApiKey;
  }

  const keyHash = await bcrypt.hash(defaultAdminApiKey, 12);
  await pool.query(
    `INSERT INTO api_keys (tenant_id, key_hash, key_prefix, scope, owner_type, owner_id, label, expires_at)
     VALUES ($1, $2, $3, 'admin', 'system', NULL, 'default-admin-key', $4)
     ON CONFLICT DO NOTHING`,
    [DEFAULT_TENANT_ID, keyHash, DEFAULT_ADMIN_KEY_PREFIX, DEFAULT_ADMIN_KEY_EXPIRY],
  );

  return defaultAdminApiKey;
}

async function persistBootstrapAdminApiKey(postgresUrl: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: postgresUrl });
  try {
    await ensureDefaultAdminApiKeyPersisted(pool);
  } finally {
    await pool.end();
  }
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

async function registerAgent(
  apiBaseUrl: string,
  agentKey: string,
  workerId: string,
): Promise<string> {
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
    const persistedDefaultAdminKey = await ensureDefaultAdminApiKeyPersisted(pool);
    const adminKey = persistedDefaultAdminKey ?? generateApiKey('admin');
    const workerKey = generateApiKey('worker');
    const agentKey = generateApiKey('agent');

    if (!persistedDefaultAdminKey) {
      await insertApiKey(pool, adminKey, 'admin', 'user');
    }

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
      shouldWaitForHealth: true,
      shouldBuildImages: false,
    };
  }

  const forceBuild = parseBooleanEnv(process.env.LIVE_FORCE_DOCKER_BUILD);
  const fingerprint = resolveWorkspaceFingerprint();
  const cachedFingerprint = readBuildFingerprintCache();
  const shouldBuild = shouldBuildDockerImages(forceBuild, fingerprint, cachedFingerprint);

  return {
    shouldRunDockerSetup: true,
    shouldWaitForHealth: true,
    shouldBuildImages: shouldBuild,
    buildFingerprint: fingerprint,
  };
}

export async function setupLiveEnvironment(options: SetupOptions): Promise<LiveContext> {
  const liveConfig = getLiveConfig();
  const apiBaseUrl = liveConfig.apiBaseUrl;
  const dashboardBaseUrl = liveConfig.dashboardBaseUrl;
  const postgresUrl = liveConfig.postgresUrl;

  const setupPlan = createSetupExecutionPlan(liveConfig.skipStackSetup);

  if (setupPlan.shouldRunDockerSetup) {
    const hasConfiguredBootstrapKey = getConfiguredDefaultAdminApiKey() !== null;
    ensureBootstrapAdminKey({ allowGenerate: true });
    ensureComposeRuntimeSecrets();
    ensureDashboardCorsOrigin(dashboardBaseUrl);
    const composeCommand = composeBinary();

    if (!hasConfiguredBootstrapKey) {
      console.log(
        'Live harness compose preflight: DEFAULT_ADMIN_API_KEY not preset; resetting compose state to avoid stale bootstrap-key mismatch.',
      );
      runDocker(`${composeCommand} down -v --remove-orphans`);
    }

    const buildFlag = setupPlan.shouldBuildImages ? '--build ' : '';
    const fingerprintLabel = setupPlan.buildFingerprint?.key ?? 'unknown';
    const minFreeGiB = resolveComposeMinFreeGiB();
    assertComposeDiskFloor('/', minFreeGiB);
    console.log(
      `Live harness compose startup: ${setupPlan.shouldBuildImages ? 'rebuild' : 'reuse'} (${fingerprintLabel})`,
    );
    runDocker(`${composeCommand} up -d ${buildFlag}postgres platform-api worker dashboard`);

    if (setupPlan.shouldBuildImages && setupPlan.buildFingerprint) {
      writeBuildFingerprintCache(setupPlan.buildFingerprint);
    }
  } else {
    captureBootstrapAdminKeyFromRunningStack();
  }

  if (setupPlan.shouldWaitForHealth) {
    await waitForHealth(`${apiBaseUrl}/health`, 'platform-api health', liveConfig.healthTimeoutMs);
    await waitForPostgresReady(postgresUrl, liveConfig.healthTimeoutMs);
    await waitForApiAuthReadiness(apiBaseUrl, liveConfig.healthTimeoutMs);
    await waitForHealth(`${dashboardBaseUrl}/`, 'dashboard', liveConfig.healthTimeoutMs);
  }

  if (options.fastReset) {
    await resetLiveState(postgresUrl);
    await persistBootstrapAdminApiKey(postgresUrl);

    if (liveConfig.skipStackSetup) {
      await restartWarmFastResetServices(apiBaseUrl, postgresUrl, liveConfig.healthTimeoutMs);
    }
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
