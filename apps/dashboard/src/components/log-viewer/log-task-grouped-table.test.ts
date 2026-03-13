import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  groupByTask,
  MAX_VISIBLE_ENTRIES_PER_TASK_GROUP,
} from './log-task-grouped-table.js';
import type { LogEntry } from '../../lib/api.js';

function readSource(fileName: string): string {
  return readFileSync(resolve(import.meta.dirname, fileName), 'utf8');
}

function makeEntry(overrides: Partial<LogEntry> & { id: number }): LogEntry {
  return {
    trace_id: 'trace-1',
    span_id: 'span-1',
    source: 'test',
    category: 'tool',
    level: 'info',
    operation: 'test_op',
    status: 'completed',
    actor_type: 'agent',
    actor_id: 'agent-1',
    created_at: '2026-03-12T12:00:00.000Z',
    ...overrides,
  };
}

describe('groupByTask', () => {
  it('groups entries by task_id and preserves title and role', () => {
    const entries: LogEntry[] = [
      makeEntry({ id: 1, task_id: 'task-a', task_title: 'Deploy', role: 'engineer' }),
      makeEntry({ id: 2, task_id: 'task-a', task_title: 'Deploy', role: 'engineer' }),
      makeEntry({ id: 3, task_id: 'task-b', task_title: 'Review' }),
    ];

    const { buckets, ungroupedCount } = groupByTask(entries);

    expect(buckets).toHaveLength(2);
    expect(buckets[0].taskId).toBe('task-a');
    expect(buckets[0].taskTitle).toBe('Deploy');
    expect(buckets[0].role).toBe('engineer');
    expect(buckets[0].entries).toHaveLength(2);
    expect(buckets[1].taskId).toBe('task-b');
    expect(buckets[1].entries).toHaveLength(1);
    expect(ungroupedCount).toBe(0);
  });

  it('counts entries without a task_id as ungrouped', () => {
    const entries: LogEntry[] = [
      makeEntry({ id: 1, task_id: 'task-a', task_title: 'Deploy' }),
      makeEntry({ id: 2 }),
      makeEntry({ id: 3 }),
    ];

    const { buckets, ungroupedCount } = groupByTask(entries);

    expect(buckets).toHaveLength(1);
    expect(ungroupedCount).toBe(2);
  });

  it('returns empty buckets when no entries have task_id', () => {
    const entries: LogEntry[] = [
      makeEntry({ id: 1 }),
      makeEntry({ id: 2 }),
    ];

    const { buckets, ungroupedCount } = groupByTask(entries);

    expect(buckets).toHaveLength(0);
    expect(ungroupedCount).toBe(2);
  });

  it('truncates task_id to first 8 chars when task_title is missing', () => {
    const entries: LogEntry[] = [
      makeEntry({ id: 1, task_id: 'abcdefghijklmnop' }),
    ];

    const { buckets } = groupByTask(entries);

    expect(buckets[0].taskTitle).toBe('abcdefgh');
  });

  it('sets role to null when entry has no role', () => {
    const entries: LogEntry[] = [
      makeEntry({ id: 1, task_id: 'task-x', task_title: 'Test' }),
    ];

    const { buckets } = groupByTask(entries);

    expect(buckets[0].role).toBeNull();
  });
});

describe('MAX_VISIBLE_ENTRIES_PER_TASK_GROUP', () => {
  it('is set to a reasonable bounded rendering limit', () => {
    expect(MAX_VISIBLE_ENTRIES_PER_TASK_GROUP).toBe(20);
  });
});

describe('log task grouped table source', () => {
  it('renders ARIA attributes on task group headers for accessibility', () => {
    const source = readSource('./log-task-grouped-table.tsx');
    expect(source).toContain('role="button"');
    expect(source).toContain('aria-expanded={isExpanded}');
    expect(source).toContain('aria-label={');
    expect(source).toContain('aria-hidden="true"');
  });

  it('supports keyboard activation on task group headers', () => {
    const source = readSource('./log-task-grouped-table.tsx');
    expect(source).toContain('tabIndex={0}');
    expect(source).toContain("e.key === 'Enter'");
    expect(source).toContain("e.key === ' '");
    expect(source).toContain('e.preventDefault()');
  });

  it('bounds rendered entries per expanded group with a show-more control', () => {
    const source = readSource('./log-task-grouped-table.tsx');
    expect(source).toContain('MAX_VISIBLE_ENTRIES_PER_TASK_GROUP');
    expect(source).toContain('visibleEntries');
    expect(source).toContain('hiddenCount');
    expect(source).toContain('showMoreEntries');
    expect(source).toContain('Show');
    expect(source).toContain('more');
  });

  it('labels the role badge for screen readers', () => {
    const source = readSource('./log-task-grouped-table.tsx');
    expect(source).toContain('aria-label={`Role: ${bucket.role}`}');
  });

  it('announces remaining count when more entries are hidden', () => {
    const source = readSource('./log-task-grouped-table.tsx');
    expect(source).toContain('remaining');
  });
});
