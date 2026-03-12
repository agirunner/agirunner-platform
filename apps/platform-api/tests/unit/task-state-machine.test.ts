import { describe, expect, it } from 'vitest';

import {
  canTransitionState,
  normalizeTaskState,
  normalizeTaskStateInput,
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

  it('accepts only canonical states in the primary state-machine helpers', () => {
    expect(normalizeTaskState('running')).toBeNull();
    expect(normalizeTaskState('awaiting_escalation')).toBeNull();
    expect(() => toStoredTaskState('running')).toThrow("Unknown task state 'running'");
    expect(() => toStoredTaskState('awaiting_escalation')).toThrow(
      "Unknown task state 'awaiting_escalation'",
    );
  });

  it('keeps legacy aliases confined to the explicit stale-input compatibility normalizer', () => {
    expect(normalizeTaskStateInput('running')).toBe('in_progress');
    expect(normalizeTaskStateInput('awaiting_escalation')).toBe('escalated');
    expect(normalizeTaskStateInput('in_progress')).toBe('in_progress');
    expect(canTransitionState('claimed', 'running')).toBe(false);
    expect(canTransitionState('running', 'awaiting_escalation')).toBe(false);
    expect(canTransitionState('running', 'completed')).toBe(false);
  });
});
