import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertComposeDiskFloorFromAvailableKilobytes,
  buildLiveResetTruncateSql,
  createSetupExecutionPlan,
  parseDfAvailableKilobytes,
  resolveComposeMinFreeGiB,
  selectMutableLiveTables,
  shouldBuildDockerImages,
} from './setup.js';

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
  assert.doesNotThrow(() => assertComposeDiskFloorFromAvailableKilobytes(10 * 1024 * 1024, '/', 10));
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
