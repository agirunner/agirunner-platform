import { describe, expect, it } from 'vitest';

import { normalizeTaskState } from './task-state.js';

describe('dashboard task state normalization', () => {
  it('preserves canonical task states for operator surfaces', () => {
    expect(normalizeTaskState('in_progress')).toBe('in_progress');
    expect(normalizeTaskState('escalated')).toBe('escalated');
    expect(normalizeTaskState('awaiting_approval')).toBe('awaiting_approval');
  });

  it('rewrites legacy aliases to canonical operator states', () => {
    expect(normalizeTaskState('running')).toBe('in_progress');
    expect(normalizeTaskState('awaiting_escalation')).toBe('escalated');
  });
});
