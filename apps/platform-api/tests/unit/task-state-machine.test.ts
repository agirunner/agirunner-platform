import { describe, expect, it } from 'vitest';

import {
  canTransitionState,
  normalizeTaskState,
  toStoredTaskState,
} from '../../src/orchestration/task-state-machine.js';

const states = [
  'pending',
  'ready',
  'claimed',
  'in_progress',
  'awaiting_approval',
  'output_pending_review',
  'escalated',
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
  ['claimed', 'in_progress'],
  ['claimed', 'cancelled'],
  ['in_progress', 'completed'],
  ['in_progress', 'failed'],
  ['in_progress', 'output_pending_review'],
  ['in_progress', 'escalated'],
  ['in_progress', 'cancelled'],
  ['awaiting_approval', 'ready'],
  ['awaiting_approval', 'cancelled'],
  ['output_pending_review', 'completed'],
  ['output_pending_review', 'failed'],
  ['output_pending_review', 'ready'],
  ['output_pending_review', 'cancelled'],
  ['failed', 'ready'],
  ['failed', 'escalated'],
  ['failed', 'cancelled'],
  ['escalated', 'ready'],
  ['escalated', 'cancelled'],
  ['escalated', 'failed'],
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

  it('keeps legacy aliases behind explicit normalization helpers only', () => {
    expect(normalizeTaskState('running')).toBe('in_progress');
    expect(normalizeTaskState('awaiting_escalation')).toBe('escalated');
    expect(toStoredTaskState('running')).toBe('in_progress');
    expect(toStoredTaskState('awaiting_escalation')).toBe('escalated');
  });

  it('still tolerates legacy aliases only inside the state-machine compatibility layer', () => {
    expect(canTransitionState('claimed', 'running')).toBe(true);
    expect(canTransitionState('running', 'awaiting_escalation')).toBe(true);
    expect(canTransitionState('running', 'completed')).toBe(true);
  });
});
