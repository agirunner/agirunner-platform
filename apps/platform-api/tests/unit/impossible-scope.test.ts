import { describe, expect, it } from 'vitest';

import {
  DETERMINISTIC_IMPOSSIBLE_FAILURE_MODE,
  hasDeterministicImpossibleFailureMode,
  isImpossibleRewriteObjective,
  shouldRejectImpossibleScopeTask,
} from '../../src/built-in/impossible-scope.js';

describe('isImpossibleRewriteObjective', () => {
  it('matches AP-7 style impossible rewrite objective', () => {
    expect(
      isImpossibleRewriteObjective(
        'Rewrite the entire application in Rust with no JavaScript remaining',
      ),
    ).toBe(true);
  });

  it('does not match ordinary Rust mention without impossible constraints', () => {
    expect(isImpossibleRewriteObjective('Add a Rust benchmark module for one endpoint')).toBe(
      false,
    );
  });
});

describe('hasDeterministicImpossibleFailureMode', () => {
  it('returns true when task context declares deterministic_impossible mode', () => {
    expect(
      hasDeterministicImpossibleFailureMode({
        context: {
          failure_mode: DETERMINISTIC_IMPOSSIBLE_FAILURE_MODE,
        },
      }),
    ).toBe(true);
  });

  it('returns false when failure mode is absent or different', () => {
    expect(hasDeterministicImpossibleFailureMode({ context: {} })).toBe(false);
    expect(hasDeterministicImpossibleFailureMode({ context: { failure_mode: 'other-mode' } })).toBe(
      false,
    );
  });
});

describe('shouldRejectImpossibleScopeTask', () => {
  it('detects impossible objective from task input fields', () => {
    expect(
      shouldRejectImpossibleScopeTask({
        title: 'Develop: Impossible migration',
        input: {
          goal: 'Rewrite the whole application in Rust with no JavaScript',
          instruction: 'Proceed with full rewrite now',
        },
      }),
    ).toBe(true);
  });

  it('deterministically rejects task when context failure_mode flag is set', () => {
    expect(
      shouldRejectImpossibleScopeTask({
        title: 'Implement feature safely',
        context: {
          failure_mode: DETERMINISTIC_IMPOSSIBLE_FAILURE_MODE,
        },
      }),
    ).toBe(true);
  });

  it('returns false for normal delivery tasks', () => {
    expect(
      shouldRejectImpossibleScopeTask({
        title: 'Implement multiply endpoint',
        input: {
          goal: 'Add multiply endpoint in TypeScript service',
          instruction: 'Implement tests and docs',
        },
      }),
    ).toBe(false);
  });
});
