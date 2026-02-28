import { describe, expect, it } from 'vitest';

import { compareClaimPriority, isCapabilitySubset } from '../../src/orchestration/capability-matcher.js';

describe('capability matching', () => {
  it('returns true when required set is subset of offered set', () => {
    expect(isCapabilitySubset(['typescript', 'backend'], ['backend', 'typescript', 'testing'])).toBe(true);
  });

  it('returns false when one required capability is missing', () => {
    expect(isCapabilitySubset(['typescript', 'security'], ['typescript', 'backend'])).toBe(false);
  });

  it('normalizes case and whitespace', () => {
    expect(isCapabilitySubset([' TypeScript ', 'BACKEND'], ['typescript', 'backend'])).toBe(true);
  });
});

describe('priority ordering helper', () => {
  it('orders by priority then FIFO', () => {
    const tasks = [
      { id: 'c', priority: 'normal', createdAt: new Date('2026-01-01T00:00:10Z') },
      { id: 'a', priority: 'critical', createdAt: new Date('2026-01-01T00:00:20Z') },
      { id: 'b', priority: 'critical', createdAt: new Date('2026-01-01T00:00:05Z') },
    ];

    tasks.sort(compareClaimPriority);
    expect(tasks.map((task) => task.id)).toEqual(['b', 'a', 'c']);
  });
});
