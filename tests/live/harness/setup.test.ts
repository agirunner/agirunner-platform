import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLiveResetTruncateSql,
  createSetupExecutionPlan,
  selectMutableLiveTables,
  shouldBuildDockerImages,
} from './setup.js';

test('createSetupExecutionPlan disables docker setup + health checks in skip mode', () => {
  const plan = createSetupExecutionPlan(true);

  assert.equal(plan.shouldRunDockerSetup, false);
  assert.equal(plan.shouldWaitForHealth, false);
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
