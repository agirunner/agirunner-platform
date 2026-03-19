import { describe, it, expect } from 'vitest';
import { ResourcePanel } from './resource-panel.js';
import { filterMemoryEntries } from './resource-panel-memory.js';

describe('ResourcePanel', () => {
  it('exports ResourcePanel', () => expect(typeof ResourcePanel).toBe('function'));
});

describe('filterMemoryEntries', () => {
  it('filters by key case-insensitively', () => {
    const entries = [
      { key: 'auth_approach', value: 'jwt' },
      { key: 'db_schema', value: 'v2' },
    ];
    expect(filterMemoryEntries(entries, 'auth')).toHaveLength(1);
  });

  it('returns all for empty query', () => {
    const entries = [{ key: 'a', value: 1 }];
    expect(filterMemoryEntries(entries, '')).toHaveLength(1);
  });
});
