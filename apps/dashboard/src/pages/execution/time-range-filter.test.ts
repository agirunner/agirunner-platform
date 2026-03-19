import { describe, it, expect } from 'vitest';
import { getTimeRangeCutoff, filterByTimeRange, type TimeRange } from './time-range-filter.js';

describe('getTimeRangeCutoff', () => {
  it('returns null for all range', () => {
    expect(getTimeRangeCutoff('all')).toBeNull();
  });

  it('returns a Date for 1h range', () => {
    const cutoff = getTimeRangeCutoff('1h');
    expect(cutoff).toBeInstanceOf(Date);
    const diffMs = Date.now() - cutoff!.getTime();
    expect(diffMs).toBeGreaterThan(59 * 60 * 1000);
    expect(diffMs).toBeLessThan(61 * 60 * 1000);
  });

  it('returns a Date for 24h range', () => {
    const cutoff = getTimeRangeCutoff('24h');
    expect(cutoff).toBeInstanceOf(Date);
    const diffMs = Date.now() - cutoff!.getTime();
    expect(diffMs).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(diffMs).toBeLessThan(25 * 60 * 60 * 1000);
  });
});

describe('filterByTimeRange', () => {
  const items = [
    { id: 'recent', createdAt: new Date().toISOString() },
    { id: 'old', createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString() },
    { id: 'ancient', createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString() },
  ];

  it('returns all items for all range', () => {
    const result = filterByTimeRange(items, 'all', (i) => i.createdAt);
    expect(result).toHaveLength(3);
  });

  it('filters to items within 24h', () => {
    const result = filterByTimeRange(items, '24h', (i) => i.createdAt);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('recent');
  });

  it('filters to items within 7d', () => {
    const result = filterByTimeRange(items, '7d', (i) => i.createdAt);
    expect(result).toHaveLength(2);
  });

  it('returns empty array when no items match', () => {
    const result = filterByTimeRange(items, '1h', (i) => i.createdAt);
    expect(result).toHaveLength(1);
  });
});
