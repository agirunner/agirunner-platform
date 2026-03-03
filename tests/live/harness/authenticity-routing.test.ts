import assert from 'node:assert/strict';
import test from 'node:test';

import {
  listScenariosByAuthenticityRoute,
  resolveScenarioAuthenticityRoute,
  SCENARIO_AUTHENTICITY_ROUTING,
} from './authenticity-routing.js';
import { ALL_SCENARIOS } from './runner.js';

test('authenticity routing explicitly covers every runner scenario exactly once', () => {
  const routingScenarios = SCENARIO_AUTHENTICITY_ROUTING.map((entry) => entry.scenario);

  const duplicates = routingScenarios.filter(
    (scenario, index) => routingScenarios.indexOf(scenario) !== index,
  );
  assert.equal(new Set(duplicates).size, 0, `duplicate routing entries: ${duplicates.join(', ')}`);

  const expected = [...ALL_SCENARIOS].sort();
  const actual = [...routingScenarios].sort();
  assert.deepEqual(actual, expected);
});

test('hybrid vs deterministic partitions are explicit and stable', () => {
  const hybrid = listScenariosByAuthenticityRoute('hybrid-llm').sort();
  const deterministic = listScenariosByAuthenticityRoute('deterministic').sort();

  assert.deepEqual(hybrid, [
    'ap5-full',
    'ap7-failure-recovery',
    'maintenance-happy',
    'sdlc-happy',
    'sdlc-sad',
  ]);

  assert.equal(hybrid.length + deterministic.length, ALL_SCENARIOS.length);

  for (const scenario of ALL_SCENARIOS) {
    const route = resolveScenarioAuthenticityRoute(scenario);
    assert.ok(route === 'hybrid-llm' || route === 'deterministic');
  }
});
