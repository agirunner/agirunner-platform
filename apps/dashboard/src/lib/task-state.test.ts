import { describe, expect, it } from 'vitest';

import { normalizeTaskState } from './task-state.js';

describe('dashboard task state normalization', () => {
  it('preserves canonical task states for operator surfaces', () => {
    expect(normalizeTaskState('in_progress')).toBe('in_progress');
    expect(normalizeTaskState('escalated')).toBe('escalated');
    expect(normalizeTaskState('awaiting_approval')).toBe('awaiting_approval');
  });

  it('does not rewrite legacy aliases inside operator helpers', () => {
    expect(normalizeTaskState('running')).toBe('running');
    expect(normalizeTaskState('awaiting_escalation')).toBe('awaiting_escalation');
  });
});
