import { describe, it, expect } from 'vitest';
import { groupTasksByColumn, getRoleAccentVar } from './task-kanban.js';

describe('groupTasksByColumn', () => {
  it('groups tasks by columnId', () => {
    const columns = [{ id: 'active', name: 'Active' }, { id: 'done', name: 'Done' }];
    const tasks = [
      { id: '1', title: 'A', state: 'in_progress', columnId: 'active' },
      { id: '2', title: 'B', state: 'completed', columnId: 'done' },
      { id: '3', title: 'C', state: 'in_progress', columnId: 'active' },
    ];
    const grouped = groupTasksByColumn(tasks, columns);
    expect(grouped.get('active')).toHaveLength(2);
    expect(grouped.get('done')).toHaveLength(1);
  });

  it('creates empty arrays for columns with no tasks', () => {
    const columns = [{ id: 'active', name: 'Active' }, { id: 'review', name: 'Review' }];
    const grouped = groupTasksByColumn([], columns);
    expect(grouped.get('active')).toEqual([]);
    expect(grouped.get('review')).toEqual([]);
  });
});

describe('getRoleAccentVar', () => {
  it('returns role var for known role', () => {
    expect(getRoleAccentVar('developer')).toBe('var(--role-developer)');
  });
  it('returns muted for unknown role', () => {
    expect(getRoleAccentVar('unknown')).toBe('var(--color-text-muted)');
  });
  it('returns muted for undefined', () => {
    expect(getRoleAccentVar(undefined)).toBe('var(--color-text-muted)');
  });
});
