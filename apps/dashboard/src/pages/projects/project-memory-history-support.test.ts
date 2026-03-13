import { describe, expect, it } from 'vitest';

import type { MemoryEntry } from './project-memory-support.js';
import {
  buildMemoryActorOptions,
  buildMemoryHistoryReview,
  buildMemoryRevisionOptions,
  buildMemoryKeyOptions,
  buildMemoryRevisionId,
  describeMemoryRevisionLabel,
  filterScopedMemoryEntries,
  formatMemoryActor,
  stringifyMemoryValue,
} from './project-memory-history-support.js';

const historyEntries: MemoryEntry[] = [
  {
    key: 'review_note',
    value: { summary: 'latest', blockers: ['tests'] },
    scope: 'work_item',
    eventId: 3,
    workflowId: 'workflow-1',
    workItemId: 'wi-1',
    taskId: 'task-3',
    stageName: 'review',
    actorType: 'agent',
    actorId: 'reviewer',
    updatedAt: '2026-03-11T10:00:00.000Z',
    eventType: 'updated',
  },
  {
    key: 'review_note',
    value: { summary: 'older' },
    scope: 'work_item',
    eventId: 2,
    workflowId: 'workflow-1',
    workItemId: 'wi-1',
    taskId: 'task-2',
    stageName: 'review',
    actorType: 'system',
    actorId: 'orchestrator',
    updatedAt: '2026-03-10T10:00:00.000Z',
    eventType: 'updated',
  },
  {
    key: 'deployment_note',
    value: 'watch release window',
    scope: 'work_item',
    eventId: 1,
    workflowId: 'workflow-1',
    workItemId: 'wi-1',
    taskId: 'task-1',
    stageName: 'delivery',
    actorType: 'human',
    actorId: 'ops',
    updatedAt: '2026-03-09T10:00:00.000Z',
    eventType: 'updated',
  },
];

describe('project memory history support', () => {
  it('builds actor and key options for structured history filters', () => {
    expect(buildMemoryActorOptions(historyEntries)).toEqual([
      { value: 'agent:reviewer', label: 'agent • reviewer', count: 1 },
      { value: 'human:ops', label: 'human • ops', count: 1 },
      { value: 'system:orchestrator', label: 'system • orchestrator', count: 1 },
    ]);

    expect(buildMemoryKeyOptions(historyEntries)).toEqual([
      {
        value: 'deployment_note',
        count: 1,
        latestUpdatedAt: '2026-03-09T10:00:00.000Z',
      },
      {
        value: 'review_note',
        count: 2,
        latestUpdatedAt: '2026-03-11T10:00:00.000Z',
      },
    ]);
  });

  it('filters history entries by query, actor, and key', () => {
    expect(
      filterScopedMemoryEntries(historyEntries, {
        query: 'tests',
        actor: 'agent:reviewer',
        key: 'review_note',
      }),
    ).toEqual([historyEntries[0]]);
  });

  it('builds per-key version reviews with diff inputs', () => {
    const review = buildMemoryHistoryReview(
      historyEntries,
      'review_note',
      buildMemoryRevisionId(historyEntries[0]),
    );

    expect(review.selectedEntry).toEqual(historyEntries[0]);
    expect(review.previousEntry).toEqual(historyEntries[1]);
    expect(review.selectedText).toContain('"summary": "latest"');
    expect(review.previousText).toContain('"summary": "older"');
    expect(review.versions).toEqual([historyEntries[0], historyEntries[1]]);
  });

  it('allows custom compare baselines and exposes revision options', () => {
    const selectedRevisionId = buildMemoryRevisionId(historyEntries[0]);
    const compareRevisionId = buildMemoryRevisionId(historyEntries[1]);
    const review = buildMemoryHistoryReview(
      historyEntries,
      'review_note',
      selectedRevisionId,
      compareRevisionId,
    );

    expect(review.previousEntry).toEqual(historyEntries[1]);
    const options = buildMemoryRevisionOptions(historyEntries, 'review_note', selectedRevisionId);
    expect(options).toHaveLength(1);
    expect(options[0]?.value).toBe(compareRevisionId);
    expect(options[0]?.label).toBe('system • orchestrator updated this key');
    expect(options[0]?.helper).toContain('2026');
  });

  it('formats actor labels and stringifies memory values consistently', () => {
    expect(formatMemoryActor('agent', 'reviewer')).toBe('agent • reviewer');
    expect(formatMemoryActor('system', null)).toBe('system');
    expect(describeMemoryRevisionLabel(historyEntries[2])).toBe('human • ops updated this key');
    expect(stringifyMemoryValue({ summary: 'latest' })).toBe('{\n  "summary": "latest"\n}');
    expect(stringifyMemoryValue('watch release')).toBe('watch release');
  });
});
