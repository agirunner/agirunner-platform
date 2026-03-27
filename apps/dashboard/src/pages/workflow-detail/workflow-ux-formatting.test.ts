import { describe, expect, it } from 'vitest';

import { formatCountLabel, formatKeyPreview, formatUsdDisplay } from './workflow-ux-formatting.js';

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

  it('summarizes key previews without losing the empty-state contract', () => {
    expect(formatKeyPreview([], 'No keys')).toBe('No keys');
    expect(formatKeyPreview(['objective', 'release_train'], 'No keys')).toBe(
      'objective, release_train',
    );
    expect(
      formatKeyPreview(['objective', 'release_train', 'attempt_reason', 'review_scope'], 'No keys'),
    ).toBe('objective, release_train, attempt_reason +1 more');
  });
});
