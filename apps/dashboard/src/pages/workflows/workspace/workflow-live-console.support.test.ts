import { describe, expect, it } from 'vitest';

import type { DashboardWorkflowLiveConsoleItem } from '../../../lib/api.js';
import {
  buildWorkflowConsoleFilterDescriptors,
  describeWorkflowConsoleCoverage,
  describeWorkflowConsoleEmptyState,
  filterWorkflowConsoleItems,
} from './workflow-live-console.support.js';

describe('workflow live console support', () => {
  it('builds filter counts that reconcile with the visible scoped rows', () => {
    const items = createItems();

    expect(buildWorkflowConsoleFilterDescriptors(items)).toEqual([
      { filter: 'all', label: 'All', count: 4 },
      { filter: 'turn_updates', label: 'Turn updates', count: 3 },
      { filter: 'briefs', label: 'Briefs', count: 1 },
    ]);
  });

  it('filters the scoped console stream for turn updates and briefs', () => {
    const items = createItems();

    expect(
      filterWorkflowConsoleItems(items, 'turn_updates').map((item) => item.item_id),
    ).toEqual(['update-1', 'notice-1', 'turn-1']);
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

  it('describes when filter counts only cover the currently loaded window', () => {
    const items = createItems();

    expect(describeWorkflowConsoleCoverage(items, 'cursor-2', 9)).toBe(
      'Showing the latest 4 loaded headlines out of 9 total. Filter counts reflect the current window until you load older headlines.',
    );
    expect(describeWorkflowConsoleCoverage(items, 'cursor-2', null)).toBe(
      'Showing the latest 4 loaded headlines. Filter counts reflect the current window until you load older headlines.',
    );
    expect(describeWorkflowConsoleCoverage(items, null, 9)).toBeNull();
  });
});

function createItems(): DashboardWorkflowLiveConsoleItem[] {
  return [
    createItem({
      item_id: 'update-1',
      item_kind: 'operator_update',
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
    item_kind: 'operator_update',
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
