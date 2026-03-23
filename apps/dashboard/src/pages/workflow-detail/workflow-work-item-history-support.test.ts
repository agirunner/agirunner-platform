import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildWorkItemHistoryOverview,
  buildWorkItemHistoryPacket,
} from './workflow-work-item-history-support.js';
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

  it('builds operator-ready history overview metrics from the latest activity', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-12T22:00:00Z'));

    const overview = buildWorkItemHistoryOverview([
      {
        id: 'event-2',
        type: 'task.failed',
        entity_type: 'task',
        entity_id: 'task-abcdef12',
        actor_type: 'agent',
        actor_id: 'agent-7',
        created_at: '2026-03-12T21:50:00Z',
        data: {
          task_title: 'Investigate failing smoke test',
          task_id: 'task-abcdef12',
          work_item_id: 'workitem-12345678',
          stage_name: 'qa',
          error: 'Pytest failed',
          role: 'qa',
        },
      },
      {
        id: 'event-1',
        type: 'work_item.created',
        entity_type: 'work_item',
        entity_id: 'workitem-12345678',
        actor_type: 'agent',
        actor_id: 'agent-2',
        created_at: '2026-03-12T21:30:00Z',
        data: {
          title: 'Stabilize smoke suite',
          work_item_id: 'workitem-12345678',
          stage_name: 'qa',
        },
      },
    ]);

    expect(overview).toEqual({
      focusLabel: 'Failure',
      focusTone: 'destructive',
      focusDetail: 'Actor Agent agent-7 • Stage qa • Work item workitem • Step task-abc',
      metrics: [
        {
          label: 'Activity packets',
          value: '2',
          detail: 'Newest activity is listed first for rapid review.',
        },
        {
          label: 'Attention signals',
          value: '1',
          detail: 'Warnings and failures that may need operator follow-up.',
        },
        {
          label: 'Linked stages',
          value: '1',
          detail: 'Distinct board stages represented in this history slice.',
        },
        {
          label: 'Linked steps',
          value: '1',
          detail: 'Specialist steps referenced by the recorded activity.',
        },
      ],
    });
  });

  it('builds a work-item history packet with scope and drill-in fields', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-12T22:00:00Z'));

    const packet = buildWorkItemHistoryPacket({
      id: 'event-2',
      type: 'task.failed',
      entity_type: 'task',
      entity_id: 'task-abcdef12',
      actor_type: 'agent',
      actor_id: 'agent-7',
      created_at: '2026-03-12T21:50:00Z',
      data: {
        task_title: 'Investigate failing smoke test',
        task_id: 'task-abcdef12',
        work_item_id: 'workitem-12345678',
        stage_name: 'qa',
        error: 'Pytest failed',
        role: 'qa',
      },
    });

    expect(packet).toEqual({
      id: 'event-2',
      headline: 'Step failed: Investigate failing smoke test',
      summary: 'Pytest failed',
      scopeSummary: 'Actor Agent agent-7 • Stage qa • Work item workitem • Step task-abc',
      emphasisLabel: 'Failure',
      emphasisTone: 'destructive',
      signalBadges: ['qa'],
      stageName: 'qa',
      workItemId: 'workitem-12345678',
      taskId: 'task-abcdef12',
      actor: 'Agent agent-7',
      createdAtLabel: '10m ago',
      createdAtTitle: new Date('2026-03-12T21:50:00Z').toLocaleString(),
      payload: {
        task_title: 'Investigate failing smoke test',
        task_id: 'task-abcdef12',
        work_item_id: 'workitem-12345678',
        stage_name: 'qa',
        error: 'Pytest failed',
        role: 'qa',
      },
    });
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
