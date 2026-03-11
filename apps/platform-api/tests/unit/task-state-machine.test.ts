import { describe, expect, it } from 'vitest';

import { canTransitionState } from '../../src/orchestration/task-state-machine.js';

const states = [
  'pending',
  'ready',
  'claimed',
  'running',
  'awaiting_approval',
  'output_pending_review',
  'awaiting_escalation',
  'completed',
  'failed',
  'cancelled',
] as const;

type State = (typeof states)[number];

const validTransitions: Array<[State, State]> = [
  ['pending', 'ready'],
  ['pending', 'awaiting_approval'],
  ['pending', 'cancelled'],
  ['ready', 'claimed'],
  ['ready', 'cancelled'],
  ['claimed', 'running'],
  ['claimed', 'cancelled'],
  ['running', 'completed'],
  ['running', 'failed'],
  ['running', 'output_pending_review'],
  ['running', 'awaiting_escalation'],
  ['running', 'cancelled'],
  ['awaiting_approval', 'ready'],
  ['awaiting_approval', 'cancelled'],
  ['output_pending_review', 'completed'],
  ['output_pending_review', 'failed'],
  ['output_pending_review', 'ready'],
  ['output_pending_review', 'cancelled'],
  ['failed', 'ready'],
  ['failed', 'awaiting_escalation'],
  ['failed', 'cancelled'],
  ['awaiting_escalation', 'ready'],
  ['awaiting_escalation', 'cancelled'],
  ['awaiting_escalation', 'failed'],
];

describe('task state machine', () => {
  it('allows all valid transitions', () => {
    for (const [from, to] of validTransitions) {
      expect(canTransitionState(from, to)).toBe(true);
    }
  });

  it('rejects all invalid transitions', () => {
    const validSet = new Set(validTransitions.map(([from, to]) => `${from}->${to}`));

    for (const from of states) {
      for (const to of states) {
        const key = `${from}->${to}`;
        if (validSet.has(key)) {
          continue;
        }
        expect(canTransitionState(from, to)).toBe(false);
      }
    }
  });
});
