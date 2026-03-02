import assert from 'node:assert/strict';
import test from 'node:test';

import { createSetupExecutionPlan } from './setup.js';

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
