import { describe, expect, it } from 'vitest';

import { filterPlaybooks, partitionByStarred } from './playbook-catalog.js';

describe('filterPlaybooks', () => {
  it('filters by name case-insensitively', () => {
    const playbooks = [
      { id: '1', name: 'Feature Build', stageCount: 5, roleCount: 4 },
      { id: '2', name: 'Bug Investigation', stageCount: 3, roleCount: 2 },
    ];
    expect(filterPlaybooks(playbooks, 'bug')).toHaveLength(1);
    expect(filterPlaybooks(playbooks, 'BUG')).toHaveLength(1);
  });

  it('returns all for empty query', () => {
    const playbooks = [{ id: '1', name: 'A', stageCount: 1, roleCount: 1 }];
    expect(filterPlaybooks(playbooks, '')).toHaveLength(1);
  });
});

describe('partitionByStarred', () => {
  it('separates starred from unstarred', () => {
    const playbooks = [
      { id: '1', name: 'A', stageCount: 1, roleCount: 1 },
      { id: '2', name: 'B', stageCount: 1, roleCount: 1 },
      { id: '3', name: 'C', stageCount: 1, roleCount: 1 },
    ];
    const result = partitionByStarred(playbooks, ['1', '3']);
    expect(result.starred).toHaveLength(2);
    expect(result.unstarred).toHaveLength(1);
  });
});
