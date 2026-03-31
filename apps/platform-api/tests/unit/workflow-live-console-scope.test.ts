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

  it('keeps task-bound rows visible at selected work-item scope when the task belongs to that work item', () => {
    const items = [
      createItem({
        item_id: 'task-bound-row',
        work_item_id: null,
        task_id: 'task-1',
        linked_target_ids: ['workflow-1', 'task-1'],
        scope_binding: 'execution_context',
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
      new Map([['task-1', 'work-item-1']]),
    );

    expect(result.map((item) => item.item_id)).toEqual(['task-bound-row']);
  });

  it('excludes task-bound rows at selected work-item scope when the task belongs to a sibling work item', () => {
    const items = [
      createItem({
        item_id: 'sibling-task-row',
        work_item_id: null,
        task_id: 'task-2',
        linked_target_ids: ['workflow-1', 'task-2'],
        scope_binding: 'execution_context',
      }),
    ];

    const result = filterLiveConsoleItemsForSelectedScope(
      items,
      {
        scope_kind: 'selected_work_item',
        work_item_id: 'work-item-1',
        task_id: null,
      },
      ['work-item-1', 'work-item-2'],
      new Map([['task-2', 'work-item-2']]),
    );

    expect(result).toEqual([]);
  });

  it('keeps milestone briefs that explicitly target the selected work item even when they also reference a predecessor work item', () => {
    const items = [
      createItem({
        item_id: 'dispatch-brief',
        item_kind: 'milestone_brief',
        work_item_id: 'work-item-0',
        linked_target_ids: ['workflow-1', 'work-item-0', 'work-item-1'],
      }),
    ];

    const result = filterLiveConsoleItemsForSelectedScope(
      items,
      {
        scope_kind: 'selected_work_item',
        work_item_id: 'work-item-1',
        task_id: null,
      },
      ['work-item-0', 'work-item-1'],
    );

    expect(result.map((item) => item.item_id)).toEqual(['dispatch-brief']);
  });

  it('keeps structured-target execution turns whose primary target is the selected work item', () => {
    const items = [
      createItem({
        item_id: 'selected-work-item-turn',
        work_item_id: 'work-item-1',
        linked_target_ids: ['workflow-1', 'work-item-0', 'work-item-1'],
        scope_binding: 'structured_target',
      }),
    ];

    const result = filterLiveConsoleItemsForSelectedScope(
      items,
      {
        scope_kind: 'selected_work_item',
        work_item_id: 'work-item-1',
        task_id: null,
      },
      ['work-item-0', 'work-item-1'],
    );

    expect(result.map((item) => item.item_id)).toEqual(['selected-work-item-turn']);
  });

  it('excludes workflow-only rows with no task or work-item binding from selected work-item scope', () => {
    const items = [
      createItem({
        item_id: 'workflow-only',
        work_item_id: null,
        task_id: null,
        linked_target_ids: [],
        scope_binding: 'execution_context',
      }),
      createItem({
        item_id: 'selected-work-item-turn',
        work_item_id: 'work-item-1',
        linked_target_ids: ['workflow-1', 'work-item-1'],
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

    expect(result.map((item) => item.item_id)).toEqual(['selected-work-item-turn']);
  });

  it('excludes workflow-only rows with no task or work-item binding from selected task scope', () => {
    const items = [
      createItem({
        item_id: 'workflow-only',
        work_item_id: null,
        task_id: null,
        linked_target_ids: [],
        scope_binding: 'execution_context',
      }),
      createItem({
        item_id: 'selected-task-only',
        task_id: 'task-1',
        linked_target_ids: ['workflow-1', 'work-item-1', 'task-1'],
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
