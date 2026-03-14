import { describe, expect, it } from 'vitest';

import { formatCountLabel, formatUsdDisplay } from './workflow-ux-formatting.js';

describe('workflow ux formatting', () => {
  it('formats surface currency with operator-friendly precision', () => {
    expect(formatUsdDisplay(0)).toBe('$0.00');
    expect(formatUsdDisplay(1.2345)).toBe('$1.23');
  });

  it('uses plural-aware copy for bounded count badges', () => {
    expect(formatCountLabel(0, 'stale turn', 'No stale turns')).toBe('No stale turns');
    expect(formatCountLabel(1, 'stale turn', 'No stale turns')).toBe('1 stale turn');
    expect(formatCountLabel(2, 'stale turn', 'No stale turns')).toBe('2 stale turns');
  });
});
