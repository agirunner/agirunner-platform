import { describe, expect, it } from 'vitest';

import { filterLiveConsoleItemsForSelectedScope } from '../../src/services/workflow-operations/workflow-live-console-scope.js';

describe('workflow live console scope', () => {
  it('excludes rows that also target a sibling task from selected-task scope', () => {
    const items = [
      createItem({
        item_id: 'selected-task-only',
        task_id: 'task-1',
        linked_target_ids: ['workflow-1', 'work-item-1', 'task-1'],
      }),
      createItem({
        item_id: 'cross-task-shared',
        task_id: 'task-2',
        linked_target_ids: ['workflow-1', 'work-item-1', 'task-1', 'task-2'],
      }),
    ];

    const result = filterLiveConsoleItemsForSelectedScope(
      items,
      {
        scope_kind: 'selected_task',
        work_item_id: 'work-item-1',
        task_id: 'task-1',
      },
      ['work-item-1'],
    );

    expect(result.map((item) => item.item_id)).toEqual(['selected-task-only']);
  });

  it('keeps shared task rows visible at the selected work-item scope', () => {
    const items = [
      createItem({
        item_id: 'cross-task-shared',
        task_id: null,
        linked_target_ids: ['workflow-1', 'work-item-1', 'task-1', 'task-2'],
      }),
    ];

    const result = filterLiveConsoleItemsForSelectedScope(
      items,
      {
        scope_kind: 'selected_work_item',
        work_item_id: 'work-item-1',
        task_id: null,
      },
      ['work-item-1'],
    );

    expect(result.map((item) => item.item_id)).toEqual(['cross-task-shared']);
  });
});

function createItem(
  overrides: Partial<Parameters<typeof filterLiveConsoleItemsForSelectedScope>[0][number]> & {
    item_id: string;
    linked_target_ids: string[];
  },
): Parameters<typeof filterLiveConsoleItemsForSelectedScope>[0][number] {
  const {
    item_id,
    linked_target_ids,
    ...rest
  } = overrides;
  return {
    item_id,
    item_kind: 'execution_turn',
    source_kind: 'orchestrator',
    source_label: 'Orchestrator',
    headline: item_id,
    summary: item_id,
    created_at: '2026-03-29T13:30:00.000Z',
    work_item_id: 'work-item-1',
    task_id: null,
    linked_target_ids,
    scope_binding: 'structured_target',
    ...rest,
  };
}
