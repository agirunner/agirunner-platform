import { describe, expect, it } from 'vitest';

import type { DashboardWorkflowLiveConsoleItem } from '../../../lib/api.js';
import {
  buildWorkflowConsoleFilterDescriptors,
  buildWorkflowConsoleFilterDescriptorsWithCounts,
  describeWorkflowConsoleCoverage,
  describeWorkflowConsoleEmptyState,
  describeWorkflowConsoleScope,
  filterWorkflowConsoleItems,
  getWorkflowConsoleFollowBehavior,
  getWorkflowConsoleScrollBehavior,
  getWorkflowConsoleEntryPrefix,
  getWorkflowConsoleEntryStyle,
  getWorkflowConsoleLineText,
  orderWorkflowConsoleItemsForDisplay,
  resolveWorkflowConsoleWindowChange,
  resolveWorkflowConsoleFilterCounts,
  shouldPrefetchWorkflowConsoleHistory,
} from './workflow-live-console.support.js';

describe('workflow live console support', () => {
  it('builds filter counts that reconcile with the visible scoped rows', () => {
    const items = createItems();

    expect(buildWorkflowConsoleFilterDescriptors(items)).toEqual([
      { filter: 'all', label: 'All', count: 4 },
      { filter: 'turn_updates', label: 'Turn updates', count: 2 },
      { filter: 'briefs', label: 'Briefs', count: 1 },
    ]);
  });

  it('prefers packet-provided filter totals while preserving loaded-item filtering', () => {
    const items = createItems();
    const packet = {
      generated_at: '2026-03-27T04:05:00.000Z',
      latest_event_id: 42,
      snapshot_version: 'workflow-operations:42',
      next_cursor: 'cursor-1',
      total_count: 137,
      items,
      counts: {
        all: 137,
        turn_updates: 101,
        briefs: 36,
      },
    };

    const counts = resolveWorkflowConsoleFilterCounts(
      packet as Parameters<typeof resolveWorkflowConsoleFilterCounts>[0],
      items,
    );

    expect(counts).toEqual({
      all: 137,
      turn_updates: 101,
      briefs: 36,
    });
    expect(buildWorkflowConsoleFilterDescriptorsWithCounts(items, counts)).toEqual([
      { filter: 'all', label: 'All', count: 137 },
      { filter: 'turn_updates', label: 'Turn updates', count: 101 },
      { filter: 'briefs', label: 'Briefs', count: 36 },
    ]);
    expect(filterWorkflowConsoleItems(items, 'all').map((item) => item.item_id)).toEqual([
      'update-1',
      'brief-1',
      'notice-1',
      'turn-1',
    ]);
  });

  it('falls back to packet total_count for the all badge when per-filter totals are absent', () => {
    const items = createItems();
    const packet = {
      generated_at: '2026-03-27T04:05:00.000Z',
      latest_event_id: 42,
      snapshot_version: 'workflow-operations:42',
      next_cursor: 'cursor-1',
      total_count: 9,
      items,
    };

    expect(
      resolveWorkflowConsoleFilterCounts(
        packet as Parameters<typeof resolveWorkflowConsoleFilterCounts>[0],
        items,
      ),
    ).toEqual({
      all: 9,
      turn_updates: 2,
      briefs: 1,
    });
  });

  it('reads compatibility filter counts from camelCase live-console payload aliases', () => {
    const items = createItems();
    const packet = {
      generated_at: '2026-03-27T04:05:00.000Z',
      latest_event_id: 42,
      snapshot_version: 'workflow-operations:42',
      next_cursor: 'cursor-1',
      totalCount: 137,
      items,
      filterCounts: {
        turnUpdates: 101,
        briefs: 36,
      },
    };

    expect(
      resolveWorkflowConsoleFilterCounts(
        packet as Parameters<typeof resolveWorkflowConsoleFilterCounts>[0],
        items,
      ),
    ).toEqual({
      all: 137,
      turn_updates: 101,
      briefs: 36,
    });
  });

  it('drops deprecated operator-update items from live-console filters and counts', () => {
    const items = [
      createItem({
        item_id: 'legacy-update-1',
        item_kind: 'operator_update',
        headline: 'Legacy operator update that should stay hidden.',
      }),
      ...createItems(),
    ];

    expect(buildWorkflowConsoleFilterDescriptors(items)).toEqual([
      { filter: 'all', label: 'All', count: 4 },
      { filter: 'turn_updates', label: 'Turn updates', count: 2 },
      { filter: 'briefs', label: 'Briefs', count: 1 },
    ]);
    expect(filterWorkflowConsoleItems(items, 'all').map((item) => item.item_id)).toEqual([
      'update-1',
      'brief-1',
      'notice-1',
      'turn-1',
    ]);
  });

  it('filters the scoped console stream for turn updates and briefs', () => {
    const items = createItems();

    expect(filterWorkflowConsoleItems(items, 'turn_updates').map((item) => item.item_id)).toEqual([
      'update-1',
      'turn-1',
    ]);
    expect(filterWorkflowConsoleItems(items, 'briefs').map((item) => item.item_id)).toEqual([
      'brief-1',
    ]);
    expect(filterWorkflowConsoleItems(items, 'all').map((item) => item.item_id)).toEqual([
      'update-1',
      'brief-1',
      'notice-1',
      'turn-1',
    ]);
  });

  it('keeps filter counts reconciled with mixed live-console content when notices are present', () => {
    const items = createItems();
    const descriptors = buildWorkflowConsoleFilterDescriptors(items);

    expect(descriptors.find((descriptor) => descriptor.filter === 'all')?.count).toBe(
      filterWorkflowConsoleItems(items, 'all').length,
    );
    expect(descriptors.find((descriptor) => descriptor.filter === 'turn_updates')?.count).toBe(
      filterWorkflowConsoleItems(items, 'turn_updates').length,
    );
    expect(descriptors.find((descriptor) => descriptor.filter === 'briefs')?.count).toBe(
      filterWorkflowConsoleItems(items, 'briefs').length,
    );
  });

  it('describes scope-aware empty states for each filter', () => {
    expect(describeWorkflowConsoleEmptyState('all', 'Task: Verify deliverable')).toBe(
      'No live console entries recorded for Task: Verify deliverable yet.',
    );
    expect(describeWorkflowConsoleEmptyState('turn_updates', 'Task: Verify deliverable')).toBe(
      'No turn updates recorded for Task: Verify deliverable yet.',
    );
    expect(describeWorkflowConsoleEmptyState('briefs', 'Task: Verify deliverable')).toBe(
      'No briefs recorded for Task: Verify deliverable yet.',
    );
  });

  it('describes the current scope explicitly for workflow, work-item, and task views', () => {
    expect(describeWorkflowConsoleScope('workflow', 'Workflow: Release workflow')).toBe(
      'Showing the workflow stream for Workflow: Release workflow.',
    );
    expect(describeWorkflowConsoleScope('work item', 'Work item: workflows-intake-01')).toBe(
      'Showing the selected work item stream for Work item: workflows-intake-01.',
    );
    expect(describeWorkflowConsoleScope('task', 'Task: Verify deliverable')).toBe(
      'Showing the selected task stream for Task: Verify deliverable.',
    );
  });

  it('uses the canonical headline when present and falls back to the summary when needed', () => {
    expect(
      getWorkflowConsoleLineText(
        createItem({
          item_id: 'update-2',
          headline: '  Canonical headline  ',
          summary: 'Summary fallback',
        }),
      ),
    ).toBe('Canonical headline');
    expect(
      getWorkflowConsoleLineText(
        createItem({
          item_id: 'update-3',
          headline: '   ',
          summary: '  Summary fallback  ',
        }),
      ),
    ).toBe('Summary fallback');
  });

  it('reports the brief label prefix only for milestone briefs', () => {
    expect(getWorkflowConsoleEntryPrefix(createItem({
      item_id: 'brief-2',
      item_kind: 'milestone_brief',
      headline: 'Approval milestone brief published.',
    }))).toBe('[Brief]');
    expect(getWorkflowConsoleEntryPrefix(createItem({
      item_id: 'turn-2',
      item_kind: 'execution_turn',
      headline: '[Think] Reviewed the latest handoff.',
    }))).toBeNull();
  });

  it('keeps live mode pinned to the bottom until pause allows upward history prefetch', () => {
    expect(
      getWorkflowConsoleScrollBehavior({
        followMode: 'live',
        hasNextCursor: true,
        isLoadingOlderHistory: false,
        scrollTop: 0,
        scrollHeight: 1_200,
        clientHeight: 500,
      }),
    ).toEqual({
      isAtLiveEdge: false,
      shouldClearQueuedUpdates: false,
      shouldPrefetchHistory: false,
      shouldStickToLiveEdge: true,
    });

    expect(
      getWorkflowConsoleScrollBehavior({
        followMode: 'paused',
        hasNextCursor: true,
        isLoadingOlderHistory: false,
        scrollTop: 0,
        scrollHeight: 1_200,
        clientHeight: 500,
      }),
    ).toEqual({
      isAtLiveEdge: false,
      shouldClearQueuedUpdates: false,
      shouldPrefetchHistory: true,
      shouldStickToLiveEdge: false,
    });
  });

  it('describes when filter counts only cover the currently loaded window', () => {
    const items = createItems();

    expect(describeWorkflowConsoleCoverage(items, 'cursor-2', 9)).toBe(
      'Showing the latest 4 loaded lines out of 9 total. Older lines stream in automatically as you scroll upward.',
    );
    expect(describeWorkflowConsoleCoverage(items, 'cursor-2', null)).toBe(
      'Showing the latest 4 loaded lines. Older lines stream in automatically as you scroll upward.',
    );
    expect(describeWorkflowConsoleCoverage(items, null, 9)).toBeNull();
  });

  it('orders the terminal stream oldest-first so newer lines append at the bottom', () => {
    expect(
      orderWorkflowConsoleItemsForDisplay([
        createItem({
          item_id: 'newest',
          headline: 'Newest line',
          created_at: '2026-03-28T03:05:00.000Z',
        }),
        createItem({
          item_id: 'older',
          headline: 'Older line',
          created_at: '2026-03-28T03:00:00.000Z',
        }),
      ]).map((item) => item.item_id),
    ).toEqual(['older', 'newest']);
  });

  it('requests older console history before the user hits the absolute top edge', () => {
    expect(
      shouldPrefetchWorkflowConsoleHistory({
        hasNextCursor: true,
        isLoadingOlderHistory: false,
        scrollTop: 72,
      }),
    ).toBe(true);
    expect(
      shouldPrefetchWorkflowConsoleHistory({
        hasNextCursor: true,
        isLoadingOlderHistory: false,
        scrollTop: 192,
      }),
    ).toBe(false);
    expect(
      shouldPrefetchWorkflowConsoleHistory({
        hasNextCursor: false,
        isLoadingOlderHistory: false,
        scrollTop: 24,
      }),
    ).toBe(false);
    expect(
      shouldPrefetchWorkflowConsoleHistory({
        hasNextCursor: true,
        isLoadingOlderHistory: true,
        scrollTop: 24,
      }),
    ).toBe(false);
  });

  it('pins live follow to the bottom instead of prefetching when the operator scrolls upward in live mode', () => {
    expect(
      getWorkflowConsoleScrollBehavior({
        followMode: 'live',
        hasNextCursor: true,
        isLoadingOlderHistory: false,
        scrollTop: 72,
        scrollHeight: 800,
        clientHeight: 200,
      }),
    ).toEqual({
      isAtLiveEdge: false,
      shouldClearQueuedUpdates: false,
      shouldPrefetchHistory: false,
      shouldStickToLiveEdge: true,
    });
  });

  it('allows scroll-triggered history prefetch once live follow is paused', () => {
    expect(
      getWorkflowConsoleScrollBehavior({
        followMode: 'paused',
        hasNextCursor: true,
        isLoadingOlderHistory: false,
        scrollTop: 72,
        scrollHeight: 800,
        clientHeight: 200,
      }),
    ).toEqual({
      isAtLiveEdge: false,
      shouldClearQueuedUpdates: false,
      shouldPrefetchHistory: true,
      shouldStickToLiveEdge: false,
    });
  });

  it('auto-follows appended entries only while live follow is enabled', () => {
    expect(
      getWorkflowConsoleFollowBehavior({
        followMode: 'live',
        isAtLiveEdge: true,
        prependedHistory: false,
        appendedLiveUpdate: true,
        hasPreviousItems: true,
      }),
    ).toEqual({
      shouldScrollToBottom: true,
      shouldQueueUpdates: false,
    });
    expect(
      getWorkflowConsoleFollowBehavior({
        followMode: 'live',
        isAtLiveEdge: false,
        prependedHistory: false,
        appendedLiveUpdate: true,
        hasPreviousItems: true,
      }),
    ).toEqual({
      shouldScrollToBottom: true,
      shouldQueueUpdates: false,
    });
    expect(
      getWorkflowConsoleFollowBehavior({
        followMode: 'paused',
        isAtLiveEdge: true,
        prependedHistory: false,
        appendedLiveUpdate: true,
        hasPreviousItems: true,
      }),
    ).toEqual({
      shouldScrollToBottom: false,
      shouldQueueUpdates: true,
    });
    expect(
      getWorkflowConsoleFollowBehavior({
        followMode: 'paused',
        isAtLiveEdge: false,
        prependedHistory: true,
        appendedLiveUpdate: false,
        hasPreviousItems: true,
      }),
    ).toEqual({
      shouldScrollToBottom: false,
      shouldQueueUpdates: false,
    });
  });

  it('treats a shifted live window as an appended update when newer rows push older ones out', () => {
    expect(
      resolveWorkflowConsoleWindowChange({
        previousItemIds: ['line-1', 'line-2', 'line-3'],
        currentItemIds: ['line-2', 'line-3', 'line-4'],
      }),
    ).toEqual({
      prependedHistory: false,
      appendedLiveUpdate: true,
    });
  });

  it('keeps terminal rows flat while tinting the prompt by role family', () => {
    expect(getWorkflowConsoleEntryStyle('operator_update', 'orchestrator')).toMatchObject({
      dataKind: 'update',
      promptClassName: 'text-sky-300',
      sourceClassName: 'text-sky-100',
    });
    expect(getWorkflowConsoleEntryStyle('operator_update', 'specialist')).toMatchObject({
      dataKind: 'update',
      promptClassName: 'text-emerald-300',
      sourceClassName: 'text-emerald-100',
    });
    expect(getWorkflowConsoleEntryStyle('platform_notice', 'platform')).toMatchObject({
      dataKind: 'notice',
      promptClassName: 'text-amber-300',
      sourceClassName: 'text-amber-100',
    });
  });
});

function createItems(): DashboardWorkflowLiveConsoleItem[] {
  return [
    createItem({
      item_id: 'update-1',
      item_kind: 'execution_turn',
      headline: 'Implementation updated retry handling.',
    }),
    createItem({
      item_id: 'brief-1',
      item_kind: 'milestone_brief',
      headline: 'Approval milestone brief published.',
    }),
    createItem({
      item_id: 'notice-1',
      item_kind: 'platform_notice',
      headline: 'Transport retried after reconnect.',
    }),
    createItem({
      item_id: 'turn-1',
      item_kind: 'execution_turn',
      headline: 'Verifier completed a new turn.',
    }),
  ];
}

function createItem(
  overrides: Partial<DashboardWorkflowLiveConsoleItem> &
    Pick<DashboardWorkflowLiveConsoleItem, 'item_id' | 'headline'>,
): DashboardWorkflowLiveConsoleItem {
  return {
    item_kind: 'execution_turn',
    source_kind: 'specialist',
    source_label: 'Verifier',
    summary: 'Summary',
    created_at: '2026-03-28T03:00:00.000Z',
    work_item_id: null,
    task_id: null,
    linked_target_ids: [],
    ...overrides,
  };
}
