import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { resolveAp6TodoFixtureRepo } from '../scenarios/ap6-runtime-maintenance.js';

test('AP-6 resolves todo-app fixture path from LIVE_FIXTURE_ROOT at runtime', () => {
  const previous = process.env.LIVE_FIXTURE_ROOT;

  process.env.LIVE_FIXTURE_ROOT = '/tmp/agirunner-live-runtime-a/fixtures';
  assert.equal(
    resolveAp6TodoFixtureRepo(),
    path.join('/tmp/agirunner-live-runtime-a/fixtures', 'todo-app'),
  );

  process.env.LIVE_FIXTURE_ROOT = '/tmp/agirunner-live-runtime-b/fixtures';
  assert.equal(
    resolveAp6TodoFixtureRepo(),
    path.join('/tmp/agirunner-live-runtime-b/fixtures', 'todo-app'),
  );

  if (previous === undefined) {
    delete process.env.LIVE_FIXTURE_ROOT;
  } else {
    process.env.LIVE_FIXTURE_ROOT = previous;
  }
});
