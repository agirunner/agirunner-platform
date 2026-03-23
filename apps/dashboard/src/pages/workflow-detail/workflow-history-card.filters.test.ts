import { describe, expect, it } from 'vitest';

import type { DashboardEventRecord } from '../../lib/api.js';
import { buildTimelineContext } from './workflow-history-card.narrative.js';
import {
  buildTimelineRecords,
  filterAndSortTimelineRecords,
  paginateTimelineRecords,
  TIMELINE_PAGE_SIZE,
  totalTimelinePages,
} from './workflow-history-card.filters.js';

function buildEvent(
  overrides: Partial<DashboardEventRecord>,
): DashboardEventRecord {
  return {
    id: 'event-1',
    type: 'workflow.created',
    entity_type: 'workflow',
    entity_id: 'workflow-1',
    actor_type: 'orchestrator',
    actor_id: 'task-1',
    data: {},
    created_at: '2026-03-12T10:00:00.000Z',
    ...overrides,
  };
}

const context = buildTimelineContext({
  activations: [],
  childWorkflows: [],
  stages: [],
  tasks: [],
  workItems: [],
});

describe('timeline record building', () => {
  it('produces a searchable text index from the descriptor', () => {
    const records = buildTimelineRecords(
      [buildEvent({ type: 'workflow.created' })],
      context,
    );

    expect(records).toHaveLength(1);
    expect(records[0].searchText).toContain('orchestrator');
    expect(records[0].descriptor.headline.length).toBeGreaterThan(0);
  });
});

describe('timeline filtering', () => {
  const events: DashboardEventRecord[] = [
    buildEvent({
      id: 'e-1',
      type: 'workflow.created',
      created_at: '2026-03-12T10:00:00.000Z',
    }),
    buildEvent({
      id: 'e-2',
      type: 'stage.gate.request_changes',
      data: { stage_name: 'design', feedback: 'Needs revision' },
      created_at: '2026-03-12T11:00:00.000Z',
    }),
    buildEvent({
      id: 'e-3',
      type: 'budget.exceeded',
      actor_type: 'system',
      data: { dimensions: ['cost'] },
      created_at: '2026-03-12T12:00:00.000Z',
    }),
  ];
  const records = buildTimelineRecords(events, context);

  it('returns all records with default filters', () => {
    const result = filterAndSortTimelineRecords(records, {
      query: '',
      signal: 'all',
      sort: 'newest',
    });
    expect(result).toHaveLength(3);
  });

  it('filters by text query against search text', () => {
    const result = filterAndSortTimelineRecords(records, {
      query: 'revision',
      signal: 'all',
      sort: 'newest',
    });
    expect(result).toHaveLength(1);
    expect(result[0].event.id).toBe('e-2');
  });

  it('filters by signal matching emphasisTone', () => {
    const result = filterAndSortTimelineRecords(records, {
      query: '',
      signal: 'warning',
      sort: 'newest',
    });
    expect(result.every((r) => r.descriptor.emphasisTone === 'warning')).toBe(
      true,
    );
  });

  it('filters by attention signal to include warning and destructive', () => {
    const result = filterAndSortTimelineRecords(records, {
      query: '',
      signal: 'attention',
      sort: 'newest',
    });
    expect(
      result.every(
        (r) =>
          r.descriptor.emphasisTone === 'warning' ||
          r.descriptor.emphasisTone === 'destructive',
      ),
    ).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it('sorts newest first by default', () => {
    const result = filterAndSortTimelineRecords(records, {
      query: '',
      signal: 'all',
      sort: 'newest',
    });
    expect(result[0].event.id).toBe('e-3');
    expect(result[result.length - 1].event.id).toBe('e-1');
  });

  it('sorts oldest first when requested', () => {
    const result = filterAndSortTimelineRecords(records, {
      query: '',
      signal: 'all',
      sort: 'oldest',
    });
    expect(result[0].event.id).toBe('e-1');
    expect(result[result.length - 1].event.id).toBe('e-3');
  });

  it('sorts by attention rank when requested', () => {
    const result = filterAndSortTimelineRecords(records, {
      query: '',
      signal: 'all',
      sort: 'attention',
    });
    const tones = result.map((r) => r.descriptor.emphasisTone);
    const destructiveIdx = tones.indexOf('destructive');
    const warningIdx = tones.indexOf('warning');
    if (destructiveIdx >= 0 && warningIdx >= 0) {
      expect(destructiveIdx).toBeLessThan(warningIdx);
    }
  });
});

describe('timeline pagination', () => {
  it('returns a bounded page of records', () => {
    const events = Array.from({ length: 25 }, (_, i) =>
      buildEvent({
        id: `e-${i}`,
        created_at: `2026-03-12T${String(i).padStart(2, '0')}:00:00.000Z`,
      }),
    );
    const records = buildTimelineRecords(events, context);

    const page0 = paginateTimelineRecords(records, 0, TIMELINE_PAGE_SIZE);
    expect(page0).toHaveLength(TIMELINE_PAGE_SIZE);

    const page2 = paginateTimelineRecords(records, 2, TIMELINE_PAGE_SIZE);
    expect(page2).toHaveLength(5);
  });

  it('computes total pages correctly', () => {
    expect(totalTimelinePages(0)).toBe(1);
    expect(totalTimelinePages(10)).toBe(1);
    expect(totalTimelinePages(11)).toBe(2);
    expect(totalTimelinePages(25)).toBe(3);
  });

  it('clamps negative page numbers to zero', () => {
    const records = buildTimelineRecords(
      [buildEvent({ id: 'e-1' })],
      context,
    );
    const result = paginateTimelineRecords(records, -5, TIMELINE_PAGE_SIZE);
    expect(result).toHaveLength(1);
  });
});
