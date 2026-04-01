import { describe, expect, it } from 'vitest';

import type { DashboardWorkflowLiveConsoleItem } from '../../../lib/api.js';
import {
  describeWorkflowConsoleCoverage,
  getWorkflowConsoleFollowBehavior,
  getWorkflowConsoleScrollBehavior,
  getWorkflowConsoleEntryPrefix,
  getWorkflowConsoleEntryStyle,
  orderWorkflowConsoleItemsForDisplay,
  resolveWorkflowConsoleWindowChange,
  shouldPrefetchWorkflowConsoleHistory,
} from './workflow-live-console.support.js';

describe('workflow live console support behavior', () => {
  it('reports the brief label prefix only for milestone briefs', () => {
    expect(
      getWorkflowConsoleEntryPrefix(
        createItem({
          item_id: 'brief-2',
          item_kind: 'milestone_brief',
          headline: 'Approval milestone brief published.',
        }),
      ),
    ).toBe('[Brief]');
    expect(
      getWorkflowConsoleEntryPrefix(
        createItem({
          item_id: 'turn-2',
          item_kind: 'execution_turn',
          headline: '[Think] Reviewed the latest handoff.',
        }),
      ),
    ).toBeNull();
  });

  it('pauses live follow when the operator scrolls away from the live edge', () => {
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
      shouldPrefetchHistory: false,
      shouldPauseFollow: true,
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
      shouldPrefetchHistory: true,
      shouldPauseFollow: false,
    });
  });

  it('describes when filter counts only cover the currently loaded window', () => {
    const items = createItems();

    expect(describeWorkflowConsoleCoverage(items, 'cursor-2', 9)).toBe(
      'Showing the latest 5 loaded lines out of 9 total. Older lines stream in automatically as you scroll upward.',
    );
    expect(describeWorkflowConsoleCoverage(items, 'cursor-2', null)).toBe(
      'Showing the latest 5 loaded lines. Older lines stream in automatically as you scroll upward.',
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

  it('reports live follow should pause when the operator scrolls upward in live mode', () => {
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
      shouldPrefetchHistory: false,
      shouldPauseFollow: true,
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
      shouldPrefetchHistory: true,
      shouldPauseFollow: false,
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
    createItem({
      item_id: 'steering-1',
      item_kind: 'steering_message',
      source_kind: 'operator',
      source_label: 'Operator',
      headline: 'Pause packaging until the rollback note is updated.',
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
