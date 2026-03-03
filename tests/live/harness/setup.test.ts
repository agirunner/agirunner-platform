import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLiveResetTruncateSql,
  createSetupExecutionPlan,
  selectMutableLiveTables,
} from './setup.js';

test('createSetupExecutionPlan disables docker setup + health checks in skip mode', () => {
  const plan = createSetupExecutionPlan(true);

  assert.equal(plan.shouldRunDockerSetup, false);
  assert.equal(plan.shouldWaitForHealth, false);
});

test('createSetupExecutionPlan enables docker setup + health checks in default mode', () => {
  const plan = createSetupExecutionPlan(false);

  assert.equal(plan.shouldRunDockerSetup, true);
  assert.equal(plan.shouldWaitForHealth, true);
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
