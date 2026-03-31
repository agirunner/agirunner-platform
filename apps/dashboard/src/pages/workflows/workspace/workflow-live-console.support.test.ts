import { posix } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { DashboardWorkflowLiveConsoleItem } from '../../../lib/api.js';
import {
  buildWorkflowConsoleFilterDescriptors,
  buildWorkflowConsoleFilterDescriptorsWithCounts,
  describeWorkflowConsoleEmptyState,
  describeWorkflowConsoleScope,
  filterWorkflowConsoleItems,
  getWorkflowConsoleDetailText,
  getWorkflowConsoleLineText,
  resolveWorkflowConsoleFilterCounts,
} from './workflow-live-console.support.js';

const taskWorkspacePath = (taskId: string, ...segments: string[]) =>
  posix.join('/', 'tmp', 'workspace', taskId, ...segments);

describe('workflow live console support', () => {
  it('builds filter counts that reconcile with the visible scoped rows', () => {
    const items = createItems();

    expect(buildWorkflowConsoleFilterDescriptors(items)).toEqual([
      { filter: 'all', label: 'All', count: 5 },
      { filter: 'turn_updates', label: 'Turn updates', count: 3 },
      { filter: 'briefs', label: 'Briefs', count: 1 },
      { filter: 'steering', label: 'Steering', count: 1 },
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
      steering: 1,
    });
    expect(buildWorkflowConsoleFilterDescriptorsWithCounts(items, counts)).toEqual([
      { filter: 'all', label: 'All', count: 137 },
      { filter: 'turn_updates', label: 'Turn updates', count: 101 },
      { filter: 'briefs', label: 'Briefs', count: 36 },
      { filter: 'steering', label: 'Steering', count: 1 },
    ]);
    expect(filterWorkflowConsoleItems(items, 'all').map((item) => item.item_id)).toEqual([
      'update-1',
      'brief-1',
      'notice-1',
      'turn-1',
      'steering-1',
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
      turn_updates: 3,
      briefs: 1,
      steering: 1,
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
      steering: 1,
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
      { filter: 'all', label: 'All', count: 5 },
      { filter: 'turn_updates', label: 'Turn updates', count: 3 },
      { filter: 'briefs', label: 'Briefs', count: 1 },
      { filter: 'steering', label: 'Steering', count: 1 },
    ]);
    expect(filterWorkflowConsoleItems(items, 'all').map((item) => item.item_id)).toEqual([
      'update-1',
      'brief-1',
      'notice-1',
      'turn-1',
      'steering-1',
    ]);
  });

  it('filters the scoped console stream for turn updates and briefs', () => {
    const items = createItems();

    expect(filterWorkflowConsoleItems(items, 'turn_updates').map((item) => item.item_id)).toEqual([
      'update-1',
      'notice-1',
      'turn-1',
    ]);
    expect(filterWorkflowConsoleItems(items, 'briefs').map((item) => item.item_id)).toEqual([
      'brief-1',
    ]);
    expect(filterWorkflowConsoleItems(items, 'steering').map((item) => item.item_id)).toEqual([
      'steering-1',
    ]);
    expect(filterWorkflowConsoleItems(items, 'all').map((item) => item.item_id)).toEqual([
      'update-1',
      'brief-1',
      'notice-1',
      'turn-1',
      'steering-1',
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

  it('uses the brief summary as inline detail only when it adds new information', () => {
    expect(
      getWorkflowConsoleDetailText(
        createItem({
          item_id: 'brief-detail-1',
          item_kind: 'milestone_brief',
          headline: 'Workflow reached approval milestone',
          summary: 'Structured approval brief published for operators.',
        }),
      ),
    ).toBe('Structured approval brief published for operators.');

    expect(
      getWorkflowConsoleDetailText(
        createItem({
          item_id: 'brief-detail-2',
          item_kind: 'milestone_brief',
          headline: 'Canonical brief summary.',
          summary: 'Canonical brief summary.',
        }),
      ),
    ).toBeNull();

    expect(
      getWorkflowConsoleDetailText(
        createItem({
          item_id: 'update-detail-1',
          item_kind: 'execution_turn',
          headline: 'Updated retry handling.',
          summary: 'Execution turn completed for Implementation Engineer.',
        }),
      ),
    ).toBeNull();
  });

  it('sanitizes literal fallback action rows down to meaningful operator-readable args', () => {
    expect(
      getWorkflowConsoleLineText(
        createItem({
          item_id: 'update-4',
          headline:
            '[Act] calling shell_exec(command="pytest tests/unit", request_id="request-1", task_id="task-1")',
          summary: 'Working through the next execution step.',
        }),
      ),
    ).toBe('calling shell_exec(command="pytest tests/unit")');
  });

  it('extracts safe nested args from structured action-call fallbacks', () => {
    expect(
      getWorkflowConsoleLineText(
        createItem({
          item_id: 'update-structured-action',
          headline:
            'calling submit_handoff(input={"summary":"Ready for operator review.","completion":"full","work_item_id":"work-item-1"})',
          summary: 'Working through the next execution step.',
        }),
      ),
    ).toBe('calling submit_handoff(summary="Ready for operator review.", completion="full")');
  });

  it('sanitizes temp workspace paths in literal helper-action fallbacks', () => {
    expect(
      getWorkflowConsoleLineText(
        createItem({
          item_id: 'update-temp-path',
          headline:
            `Policy Assessor: calling file_read(path="${taskWorkspacePath('task-4df24677-e56d-42e5-9c75-d86e9d8c01cf', 'context', 'current-task.md')}")`,
          summary: 'Working through the next execution step.',
        }),
      ),
    ).toBe('calling file_read(path="task context")');
  });

  it('normalizes predecessor handoff logical paths into brief terminology', () => {
    expect(
      getWorkflowConsoleLineText(
        createItem({
          item_id: 'update-predecessor-path',
          headline:
            'Policy Assessor: calling file_read(logical_path="context/predecessor-handoff.md")',
          summary: 'Working through the next execution step.',
        }),
      ),
    ).toBe('calling file_read(logical_path="predecessor brief")');
  });

  it('normalizes residual handoff wording in visible dashboard console text', () => {
    expect(
      getWorkflowConsoleLineText(
        createItem({
          item_id: 'update-brief-terminology',
          headline: 'Wait for the architecture lead handoff before routing implementation.',
          summary: 'Wait for the architecture lead handoff before routing implementation.',
        }),
      ),
    ).toBe('Wait for the architecture lead brief before routing implementation.');
  });

  it('keeps helper action rows with safe args while still suppressing empty fallbacks', () => {
    const items = [
      createItem({
        item_id: 'update-shell',
        headline:
          '[Act] calling shell_exec(command="pytest tests/unit", request_id="request-1")',
        summary: 'Working through the next execution step.',
      }),
      createItem({
        item_id: 'update-empty',
        headline: 'calling shell_exec()',
        summary: 'Working through the next execution step.',
      }),
      createItem({
        item_id: 'update-read-only',
        headline: 'calling file_read(path="task input")',
        summary: 'Working through the next execution step.',
      }),
    ];

    expect(filterWorkflowConsoleItems(items, 'all').map((item) => item.item_id)).toEqual([
      'update-shell',
      'update-read-only',
    ]);
    expect(buildWorkflowConsoleFilterDescriptors(items)).toEqual([
      { filter: 'all', label: 'All', count: 2 },
      { filter: 'turn_updates', label: 'Turn updates', count: 2 },
      { filter: 'briefs', label: 'Briefs', count: 0 },
      { filter: 'steering', label: 'Steering', count: 0 },
    ]);
  });

  it('suppresses prefixed raw operator-record wrappers leaked into console text', () => {
    const items = [
      createItem({
        item_id: 'update-raw-wrapper',
        headline:
          'Orchestrator: to=record_operator_update json {"request_id":"operator-update-1","payload":{"headline":"raw leak"}}',
        summary: 'Working through the next execution step.',
      }),
      createItem({
        item_id: 'update-prefixed-read',
        headline: 'Policy Assessor: calling file_read(path="task input")',
        summary: 'Working through the next execution step.',
      }),
    ];

    expect(filterWorkflowConsoleItems(items, 'all').map((item) => item.item_id)).toEqual([
      'update-prefixed-read',
    ]);
  });

  it('suppresses bare JSON blobs that do not contain operator-readable console text', () => {
    const items = [
      createItem({
        item_id: 'update-raw-json',
        headline: '{"foo":"bar","count":2}',
        summary: '{"baz":true}',
      }),
    ];

    expect(filterWorkflowConsoleItems(items, 'all')).toEqual([]);
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
