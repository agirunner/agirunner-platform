import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  WORK_ITEM_HISTORY_PAGE_SIZE,
  buildWorkItemHistoryRecords,
  filterAndSortWorkItemHistoryRecords,
  filtersToSavedViewState,
  loadPersistedWorkItemHistoryFilters,
  paginateWorkItemHistoryRecords,
  persistWorkItemHistoryFilters,
  savedViewStateToFilters,
  totalHistoryPages,
} from './workflow-work-item-history-filters.js';

describe('workflow work-item history support', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('filters, sorts, and paginates work-item history records for operator review', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-12T22:00:00Z'));

    const records = buildWorkItemHistoryRecords([
      {
        id: 'event-3',
        type: 'task.failed',
        entity_type: 'task',
        entity_id: 'task-3',
        actor_type: 'agent',
        actor_id: 'agent-9',
        created_at: '2026-03-12T21:59:00Z',
        data: {
          task_title: 'Fix flaky smoke',
          task_id: 'task-3',
          work_item_id: 'workitem-12345678',
          stage_name: 'qa',
          error: 'Smoke failure',
        },
      },
      {
        id: 'event-2',
        type: 'stage.gate_requested',
        entity_type: 'work_item',
        entity_id: 'workitem-12345678',
        actor_type: 'agent',
        actor_id: 'agent-7',
        created_at: '2026-03-12T21:50:00Z',
        data: {
          stage_name: 'qa',
          recommendation: 'Hold for operator review',
        },
      },
      {
        id: 'event-1',
        type: 'task.completed',
        entity_type: 'task',
        entity_id: 'task-1',
        actor_type: 'agent',
        actor_id: 'agent-2',
        created_at: '2026-03-12T21:30:00Z',
        data: {
          task_title: 'Draft changelog',
          task_id: 'task-1',
          work_item_id: 'workitem-12345678',
          stage_name: 'docs',
          summary: 'Changelog drafted',
        },
      },
    ]);

    const attentionRecords = filterAndSortWorkItemHistoryRecords(records, {
      query: 'qa',
      signal: 'attention',
      sort: 'attention',
    });

    expect(attentionRecords.map((record) => record.packet.id)).toEqual(['event-3', 'event-2']);
    expect(paginateWorkItemHistoryRecords(attentionRecords, 0, 1)).toHaveLength(1);
    expect(totalHistoryPages(WORK_ITEM_HISTORY_PAGE_SIZE + 1)).toBe(2);
  });

  it('persists work-item history filters and round-trips saved-view state', () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    });

    persistWorkItemHistoryFilters('workflow-1:workitem-1', {
      query: 'gate',
      signal: 'attention',
      sort: 'oldest',
    });

    expect(loadPersistedWorkItemHistoryFilters('workflow-1:workitem-1')).toEqual({
      query: 'gate',
      signal: 'attention',
      sort: 'oldest',
    });
    expect(
      savedViewStateToFilters(
        filtersToSavedViewState({
          query: 'gate',
          signal: 'attention',
          sort: 'oldest',
        }),
      ),
    ).toEqual({
      query: 'gate',
      signal: 'attention',
      sort: 'oldest',
    });
  });
});
