import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  assertComposeDiskFloorFromAvailableKilobytes,
  buildLiveResetTruncateSql,
  createSetupExecutionPlan,
  parseDfAvailableKilobytes,
  resolveComposeMinFreeGiB,
  selectMutableLiveTables,
  shouldBuildDockerImages,
  ensureDashboardCorsOrigin,
  ensureDashboardRateLimitBudget,
  DEFAULT_COMPOSE_STARTUP_SERVICES,
} from './setup.js';

test('default compose startup services include runtime sidecar topology for S3', () => {
  assert.deepEqual(DEFAULT_COMPOSE_STARTUP_SERVICES, [
    'postgres',
    'platform-api',
    'socket-proxy',
    'internal-runtime',
    'worker',
    'dashboard',
  ]);
});

test('compose topology enforces runtime internal network isolation and worker least-privilege flags', () => {
  const composePath = path.join(process.cwd(), 'docker-compose.yml');
  const compose = readFileSync(composePath, 'utf8');

  assert.match(compose, /runtime_internal:\n\s+driver: bridge\n\s+internal: true/);
  assert.match(compose, /socket-proxy:[\s\S]*?networks:\n\s+- runtime_internal/);
  assert.match(compose, /internal-runtime:[\s\S]*?networks:\n\s+- runtime_internal/);
  assert.match(
    compose,
    /worker:[\s\S]*?read_only: true[\s\S]*?security_opt:\n\s+- no-new-privileges:true[\s\S]*?cap_drop:\n\s+- ALL/,
  );
  assert.match(compose, /worker:[\s\S]*?networks:\n\s+- platform_net\n\s+- runtime_internal/);
});

test('compose runtime + worker fail fast when RUNTIME_API_KEY is unset', () => {
  const composePath = path.join(process.cwd(), 'docker-compose.yml');
  const compose = readFileSync(composePath, 'utf8');

  assert.match(
    compose,
    /internal-runtime:[\s\S]*?RUNTIME_API_KEY:\s+\$\{RUNTIME_API_KEY:\?RUNTIME_API_KEY is required\}/,
  );
  assert.doesNotMatch(
    compose,
    /internal-runtime:[\s\S]*?RUNTIME_API_KEY:\s+\$\{RUNTIME_API_KEY:-/,
  );

  assert.match(
    compose,
    /worker:[\s\S]*?RUNTIME_API_KEY:\s+\$\{RUNTIME_API_KEY:\?RUNTIME_API_KEY is required\}/,
  );
  assert.doesNotMatch(compose, /worker:[\s\S]*?RUNTIME_API_KEY:\s+\$\{RUNTIME_API_KEY:-/);
});

test('createSetupExecutionPlan disables docker setup but still waits for health in skip mode', () => {
  const plan = createSetupExecutionPlan(true);

  assert.equal(plan.shouldRunDockerSetup, false);
  assert.equal(plan.shouldWaitForHealth, true);
  assert.equal(plan.shouldBuildImages, false);
});

test('createSetupExecutionPlan enables docker setup + health checks in default mode', () => {
  const previousForceBuild = process.env.LIVE_FORCE_DOCKER_BUILD;
  delete process.env.LIVE_FORCE_DOCKER_BUILD;

  const plan = createSetupExecutionPlan(false);

  assert.equal(plan.shouldRunDockerSetup, true);
  assert.equal(plan.shouldWaitForHealth, true);

  if (previousForceBuild === undefined) delete process.env.LIVE_FORCE_DOCKER_BUILD;
  else process.env.LIVE_FORCE_DOCKER_BUILD = previousForceBuild;
});

test('selectMutableLiveTables excludes bootstrap metadata tables and keeps mutable tables', () => {
  const tables = selectMutableLiveTables([
    'schema_migrations',
    'tenants',
    'tasks',
    'events',
    'webhooks',
    'webhook_deliveries',
  ]);

  assert.deepEqual(tables, ['events', 'tasks', 'webhook_deliveries', 'webhooks']);
});

test('buildLiveResetTruncateSql produces full-table truncate for mutable state', () => {
  const sql = buildLiveResetTruncateSql(['tasks', 'workers', 'schema_migrations', 'tenants']);

  assert.equal(sql, 'TRUNCATE TABLE "tasks", "workers" RESTART IDENTITY CASCADE');
});

test('shouldBuildDockerImages forces build when requested', () => {
  const shouldBuild = shouldBuildDockerImages(
    true,
    { key: 'commit:abc123', source: 'git-commit', gitCommit: 'abc123' },
    {
      fingerprint: 'commit:abc123',
      source: 'git-commit',
      gitCommit: 'abc123',
      updatedAt: new Date().toISOString(),
    },
  );

  assert.equal(shouldBuild, true);
});

test('shouldBuildDockerImages skips build when fingerprint unchanged', () => {
  const shouldBuild = shouldBuildDockerImages(
    false,
    { key: 'commit:abc123', source: 'git-commit', gitCommit: 'abc123' },
    {
      fingerprint: 'commit:abc123',
      source: 'git-commit',
      gitCommit: 'abc123',
      updatedAt: new Date().toISOString(),
    },
  );

  assert.equal(shouldBuild, false);
});

test('shouldBuildDockerImages rebuilds when fingerprint changes', () => {
  const shouldBuild = shouldBuildDockerImages(
    false,
    { key: 'workspace:new-fingerprint', source: 'workspace-fingerprint' },
    {
      fingerprint: 'commit:abc123',
      source: 'git-commit',
      gitCommit: 'abc123',
      updatedAt: new Date().toISOString(),
    },
  );

  assert.equal(shouldBuild, true);
});

test('parseDfAvailableKilobytes extracts available column from POSIX df output', () => {
  const sample = `Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/vda1 100000000 27000000 73000000 28% /`;
  const available = parseDfAvailableKilobytes(sample);
  assert.equal(available, 73000000);
});

test('parseDfAvailableKilobytes returns null on malformed output', () => {
  assert.equal(parseDfAvailableKilobytes('Filesystem Used Avail\n'), null);
});

test('assertComposeDiskFloorFromAvailableKilobytes throws when available space is below threshold', () => {
  assert.throws(
    () => assertComposeDiskFloorFromAvailableKilobytes(2 * 1024 * 1024, '/', 10),
    /below required floor/i,
  );
});

test('assertComposeDiskFloorFromAvailableKilobytes allows available space at/above threshold', () => {
  assert.doesNotThrow(() =>
    assertComposeDiskFloorFromAvailableKilobytes(10 * 1024 * 1024, '/', 10),
  );
});

test('resolveComposeMinFreeGiB defaults to 10GiB when env is unset', () => {
  assert.equal(resolveComposeMinFreeGiB({}), 10);
});

test('resolveComposeMinFreeGiB parses valid env override', () => {
  assert.equal(resolveComposeMinFreeGiB({ LIVE_COMPOSE_MIN_FREE_GB: '12.5' }), 12.5);
});

test('resolveComposeMinFreeGiB fails closed on invalid env override', () => {
  assert.throws(
    () => resolveComposeMinFreeGiB({ LIVE_COMPOSE_MIN_FREE_GB: 'NaN' }),
    /LIVE_COMPOSE_MIN_FREE_GB must be a positive numeric value/i,
  );
});

test('ensureDashboardRateLimitBudget applies deterministic default when unset', () => {
  const env: NodeJS.ProcessEnv = {};
  const value = ensureDashboardRateLimitBudget(env, 1200);

  assert.equal(value, 1200);
  assert.equal(env.RATE_LIMIT_MAX_PER_MINUTE, '1200');
});

test('ensureDashboardRateLimitBudget rejects invalid configured value', () => {
  assert.throws(
    () => ensureDashboardRateLimitBudget({ RATE_LIMIT_MAX_PER_MINUTE: '0' }),
    /RATE_LIMIT_MAX_PER_MINUTE must be a positive integer/i,
  );
});

test('ensureDashboardCorsOrigin derives CORS_ORIGIN from dashboard URL when unset', () => {
  const env: NodeJS.ProcessEnv = {};
  const origin = ensureDashboardCorsOrigin('http://127.0.0.1:3000/login', env);

  assert.equal(origin, 'http://127.0.0.1:3000');
  assert.equal(env.CORS_ORIGIN, 'http://127.0.0.1:3000');
});

test('ensureDashboardCorsOrigin keeps explicit CORS_ORIGIN unchanged', () => {
  const env: NodeJS.ProcessEnv = { CORS_ORIGIN: 'https://dashboard.example.com' };
  const origin = ensureDashboardCorsOrigin('http://127.0.0.1:3000/login', env);

  assert.equal(origin, 'https://dashboard.example.com');
  assert.equal(env.CORS_ORIGIN, 'https://dashboard.example.com');
});
