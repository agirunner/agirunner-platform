import assert from 'node:assert/strict';
import test from 'node:test';

import { validateEventOrderAndGaps } from './events.js';

test('validateEventOrderAndGaps accepts non-contiguous ids when causal order is satisfied', () => {
  const validations = validateEventOrderAndGaps(
    [
      { id: '10', event: 'task.created' },
      { id: '15', event: 'task.updated' },
      { id: '20', event: 'task.claimed' },
      { id: '35', event: 'task.completed' },
    ],
    ['task.created', 'task.claimed', 'task.completed'],
  );

  assert.ok(validations.includes('event_order:task.created@index=0:id=10'));
  assert.ok(validations.includes('event_order:task.claimed@index=2:id=20'));
  assert.ok(validations.includes('event_order:task.completed@index=3:id=35'));
  assert.ok(validations.includes('event_ids_non_decreasing:start=10@0,end=35@3'));

  const trace = validations.find((entry) => entry.startsWith('event_trace_chain:'));
  assert.equal(
    trace,
    'event_trace_chain:task.created@0#10>task.claimed@2#20>task.completed@3#35',
  );
});

test('validateEventOrderAndGaps fails when required event is missing in order', () => {
  assert.throws(
    () =>
      validateEventOrderAndGaps(
        [
          { id: '1', event: 'task.created' },
          { id: '2', event: 'task.claimed' },
        ],
        ['task.created', 'task.claimed', 'task.completed'],
      ),
    /Expected SSE event task.completed not found after position 2/,
  );
});

test('validateEventOrderAndGaps fails when required sequence ids move backwards', () => {
  assert.throws(
    () =>
      validateEventOrderAndGaps(
        [
          { id: '22', event: 'task.created' },
          { id: '19', event: 'task.claimed' },
          { id: '23', event: 'task.completed' },
        ],
        ['task.created', 'task.claimed', 'task.completed'],
      ),
    /SSE causality breach for required sequence/,
  );
});

test('validateEventOrderAndGaps fails when stream ids regress even outside required sequence', () => {
  assert.throws(
    () =>
      validateEventOrderAndGaps(
        [
          { id: '1', event: 'task.created' },
          { id: '3', event: 'task.claimed' },
          { id: '2', event: 'heartbeat' },
        ],
        ['task.created', 'task.claimed'],
      ),
    /SSE id order violation/,
  );
});
