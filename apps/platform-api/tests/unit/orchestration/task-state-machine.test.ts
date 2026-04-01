import { describe, expect, it } from 'vitest';

import {
  assertValidTransition,
  canTransitionState,
  normalizeTaskState,
  toStoredTaskState,
} from '../../../src/orchestration/task-state-machine.js';

const states = [
  'pending',
  'ready',
  'claimed',
  'in_progress',
  'awaiting_approval',
  'output_pending_assessment',
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
  ['in_progress', 'output_pending_assessment'],
  ['in_progress', 'escalated'],
  ['in_progress', 'cancelled'],
  ['awaiting_approval', 'ready'],
  ['awaiting_approval', 'cancelled'],
  ['output_pending_assessment', 'completed'],
  ['output_pending_assessment', 'failed'],
  ['output_pending_assessment', 'ready'],
  ['output_pending_assessment', 'cancelled'],
  ['completed', 'failed'],
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

  it('rejects legacy aliases throughout the exported state helpers', () => {
    expect(canTransitionState('claimed', 'running')).toBe(false);
    expect(canTransitionState('running', 'awaiting_escalation')).toBe(false);
    expect(canTransitionState('running', 'completed')).toBe(false);
  });

  it('adds an explicit stale callback disposition when cancelled tasks reject later transitions', () => {
    try {
      assertValidTransition('task-1', 'cancelled', 'failed');
      throw new Error('expected invalid transition');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'INVALID_STATE_TRANSITION',
        details: {
          reason_code: 'task_already_cancelled',
          stale_callback_disposition: 'cancelled',
        },
      });
    }
  });
});
