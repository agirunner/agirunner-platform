import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { DashboardWorkflowLiveConsolePacket } from '../../../lib/api.js';
import { WorkflowLiveConsole } from './workflow-live-console.js';

describe('WorkflowLiveConsole', () => {
  it('renders the terminal oldest-first so the newest lines append at the bottom', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowLiveConsole, {
        packet: createPacket([
          {
            item_id: 'newer',
            headline: 'Newest headline',
            summary: 'Newest summary',
            created_at: '2026-03-27T04:05:00.000Z',
          },
          {
            item_id: 'older',
            headline: 'Older headline',
            summary: 'Older summary',
            created_at: '2026-03-27T04:00:00.000Z',
          },
        ]),
        scopeLabel: 'Workflow: Release workflow',
        scopeSubject: 'workflow',
        onLoadMore: vi.fn(),
      }),
    );

    expect(html.indexOf('Older headline')).toBeLessThan(html.indexOf('Newest headline'));
    expect(html).not.toContain('Load older headlines');
    expect(html).not.toContain('Older lines stream in automatically as you scroll upward.');
  });

  it('renders updates as single-line terminal entries and briefs with inline detail when present', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowLiveConsole, {
        packet: createPacket(
          [
            {
              item_id: 'brief-1',
              item_kind: 'milestone_brief',
              source_label: 'Orchestrator',
              headline: 'Workflow reached approval milestone',
              summary: 'A structured brief was published.',
              created_at: '2026-03-27T04:05:00.000Z',
            },
            {
              item_id: 'update-1',
              item_kind: 'execution_turn',
              source_label: 'Implementation Engineer',
              headline: 'Updated retry handling.',
              summary: 'Execution turn completed for Implementation Engineer.',
              created_at: '2026-03-27T04:04:00.000Z',
            },
          ],
          { includePlatformNotice: true },
        ),
        scopeLabel: 'Workflow: Release workflow',
        scopeSubject: 'workflow',
        onLoadMore: vi.fn(),
      }),
    );

    expect(html).toContain('data-live-console-surface="terminal"');
    expect(html).toContain('data-live-console-filter="all"');
    expect(html).toContain('data-live-console-filter="turn_updates"');
    expect(html).toContain('data-live-console-filter="briefs"');
    expect(html).toContain('data-live-console-follow-mode="live"');
    expect(html).toContain('data-live-console-follow-control="live"');
    expect(html).toContain('data-live-console-follow-control="pause"');
    expect(html).toContain('data-live-console-control-row="terminal-controls"');
    expect(html).toContain('data-live-console-follow-status="live"');
    expect(html).toContain('data-live-console-shell-cursor="live"');
    expect(html).toContain('Following live');
    expect(html).toContain('Awaiting more output');
    expect(html).toContain('data-state="active"');
    expect(html).toContain('data-state="inactive"');
    expect(html).toContain('data-live-console-follow-control="live"');
    expect(html).toContain('data-live-console-follow-control="pause"');
    expect(html).toContain('aria-pressed="true" title="Follow the latest terminal output">Live<');
    expect(html).toContain('aria-pressed="false" title="Pause terminal follow mode">Pause<');
    expect(html).toContain('data-live-console-filter-count="7"');
    expect(html).toContain('data-live-console-filter-count="2"');
    expect(html).toContain('All');
    expect(html).toContain('Turn updates');
    expect(html).toContain('Briefs');
    expect(html).toContain('[Brief]');
    expect(html).toContain('>1<');
    expect(html).toContain('>7<');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('&gt;');
    expect(html).toContain('Implementation Engineer:');
    expect(html).toContain('Updated retry handling.');
    expect(html).not.toContain('Execution turn completed for Implementation Engineer.');
    expect(html).toContain('Orchestrator:');
    expect(html).toContain(
      'Orchestrator: </span><span class="font-semibold text-emerald-200">[Brief] </span>',
    );
    expect(html).toContain('Workflow reached approval milestone');
    expect(html).toContain('A structured brief was published.');
    expect(html).toContain('Platform:');
    expect(html).toContain('Transport retried after reconnect.');
    expect(html).toContain('Workflow: Release workflow');
    expect(html).toContain('Showing the workflow stream for Workflow: Release workflow.');
    expect(html).toContain('data-terminal-entry="brief"');
    expect(html).toContain('data-terminal-entry="update"');
    expect(html).toContain('data-terminal-entry="notice"');
    expect(html).toContain('rounded-xl border border-slate-900/90 bg-[#08111f]');
    expect(html).toContain('border-b border-slate-800/80 bg-slate-950/80');
    expect(html).toContain('border-t border-slate-900/90 bg-slate-950/70');
    expect(html).toContain('inline-flex min-w-0 items-center gap-2 rounded-md border px-2.5 py-1.5');
    expect(html).toContain('flex min-w-0 items-center justify-between gap-3');
    expect(html).toContain('grid gap-px');
    expect(html).toContain('flex min-w-0 items-start gap-2 border-b border-slate-950/90 px-4 py-2 font-mono text-sm leading-6 text-slate-100');
    expect(html).toContain('min-w-0 flex-1');
    expect(html).toContain('truncate text-slate-100');
    expect(html).toContain('truncate text-xs leading-5 text-slate-400');
    expect(html).toContain('shrink-0 pl-3 text-right text-xs tabular-nums text-slate-500');
    expect(html).toContain('flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden');
    expect(html).toContain('flex shrink-0 items-center justify-end gap-1.5');
    expect(html).toContain('min-h-0 flex-1 overflow-x-hidden overflow-y-auto');
    expect(html).not.toContain('break-words');
    expect(html).not.toContain('max-h-[28rem]');
    expect(html).not.toContain('New updates');
    expect(html).not.toContain('Older lines stream in automatically as you scroll upward.');
  });

  it('prefers packet-provided filter totals over the loaded window counts', () => {
    const packet = createPacket(
      [
        {
          item_id: 'brief-1',
          item_kind: 'milestone_brief',
          source_label: 'Orchestrator',
          headline: 'Workflow reached approval milestone',
          summary: 'A structured brief was published.',
          created_at: '2026-03-27T04:05:00.000Z',
        },
        {
          item_id: 'update-1',
          item_kind: 'execution_turn',
          source_label: 'Implementation Engineer',
          headline: 'Updated retry handling.',
          summary: 'Execution turn completed for Implementation Engineer.',
          created_at: '2026-03-27T04:04:00.000Z',
        },
      ],
      { includePlatformNotice: true },
    ) as DashboardWorkflowLiveConsolePacket & {
      counts: {
        all: number;
        turn_updates: number;
        briefs: number;
      };
    };

    packet.total_count = 137;
    packet.counts = {
      all: 137,
      turn_updates: 101,
      briefs: 36,
    };

    const html = renderToStaticMarkup(
      createElement(WorkflowLiveConsole, {
        packet,
        scopeLabel: 'Workflow: Release workflow',
        scopeSubject: 'workflow',
        onLoadMore: vi.fn(),
      }),
    );

    expect(html).toContain('data-live-console-filter="all"');
    expect(html).toContain('data-live-console-filter-count="137"');
    expect(html).toContain('data-live-console-filter="turn_updates"');
    expect(html).toContain('data-live-console-filter-count="101"');
    expect(html).toContain('data-live-console-filter="briefs"');
    expect(html).toContain('data-live-console-filter-count="36"');
    expect(html).not.toContain('data-live-console-filter-count="3"');
    expect(html).not.toContain('data-live-console-filter-count="2"');
    expect(html).not.toContain('data-live-console-filter-count="1"');
  });

  it('renders compatibility filter totals when the packet uses live-console alias fields', () => {
    const packet = createPacket(
      [
        {
          item_id: 'brief-1',
          item_kind: 'milestone_brief',
          source_label: 'Orchestrator',
          headline: 'Workflow reached approval milestone',
          summary: 'A structured brief was published.',
          created_at: '2026-03-27T04:05:00.000Z',
        },
        {
          item_id: 'update-1',
          item_kind: 'execution_turn',
          source_label: 'Implementation Engineer',
          headline: 'Updated retry handling.',
          summary: 'Execution turn completed for Implementation Engineer.',
          created_at: '2026-03-27T04:04:00.000Z',
        },
      ],
      { includePlatformNotice: true },
    ) as DashboardWorkflowLiveConsolePacket & {
      totalCount: number;
      filterCounts: {
        turnUpdates: number;
        briefs: number;
      };
    };

    packet.total_count = undefined;
    packet.totalCount = 137;
    packet.filterCounts = {
      turnUpdates: 101,
      briefs: 36,
    };

    const html = renderToStaticMarkup(
      createElement(WorkflowLiveConsole, {
        packet,
        scopeLabel: 'Workflow: Release workflow',
        scopeSubject: 'workflow',
        onLoadMore: vi.fn(),
      }),
    );

    expect(html).toContain('data-live-console-filter="all"');
    expect(html).toContain('data-live-console-filter-count="137"');
    expect(html).toContain('data-live-console-filter="turn_updates"');
    expect(html).toContain('data-live-console-filter-count="101"');
    expect(html).toContain('data-live-console-filter="briefs"');
    expect(html).toContain('data-live-console-filter-count="36"');
  });

  it('humanizes role labels and falls back when the provided label is a raw uuid', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowLiveConsole, {
        packet: createPacket([
          {
            item_id: 'update-1',
            item_kind: 'execution_turn',
            source_kind: 'specialist',
            source_label: 'implementation_engineer',
            headline: 'Updated retry handling.',
            summary: 'Execution turn completed for implementation engineer.',
            created_at: '2026-03-27T04:04:00.000Z',
          },
          {
            item_id: 'update-2',
            item_kind: 'execution_turn',
            source_kind: 'orchestrator',
            source_label: '771908c8-0634-467a-b41d-6dd4a6798d7d',
            headline: 'Published workflow update.',
            summary: 'Published workflow update.',
            created_at: '2026-03-27T04:03:00.000Z',
          },
        ]),
        scopeLabel: 'Workflow: Release workflow',
        scopeSubject: 'workflow',
        onLoadMore: vi.fn(),
      }),
    );

    expect(html).toContain('Implementation Engineer:');
    expect(html).toContain('Orchestrator:');
    expect(html).not.toContain('implementation_engineer:');
    expect(html).not.toContain('771908c8-0634-467a-b41d-6dd4a6798d7d:');
  });

  it('shows task scope explicitly when a task is selected', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowLiveConsole, {
        packet: createPacket([]),
        scopeLabel: 'Task: Verify deliverable',
        scopeSubject: 'task',
        onLoadMore: vi.fn(),
      }),
    );

    expect(html).toContain('Task: Verify deliverable');
    expect(html).toContain('Showing the selected task stream for Task: Verify deliverable.');
    expect(html).toContain('No live console entries recorded for Task: Verify deliverable yet.');
    expect(html).not.toContain('this workflow yet');
  });

  it('falls back to the canonical summary when the headline is blank', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowLiveConsole, {
        packet: createPacket([
          {
            item_id: 'brief-2',
            item_kind: 'milestone_brief',
            source_label: 'Orchestrator',
            headline: '   ',
            summary: 'Canonical brief summary.',
            created_at: '2026-03-27T04:05:00.000Z',
          },
        ]),
        scopeLabel: 'Workflow: Release workflow',
        scopeSubject: 'workflow',
        onLoadMore: vi.fn(),
      }),
    );

    expect(html).toContain('Canonical brief summary.');
  });

  it('keeps terminal rows on a single line with truncation up to the timestamp column', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowLiveConsole, {
        packet: createPacket([
          {
            item_id: 'update-1',
            item_kind: 'execution_turn',
            source_label: 'Implementation Engineer',
            headline:
              'Updated retry handling for workflow deliverable promotion after orchestrator guidance changed twice in the same activation.',
            summary: 'Execution turn completed for Implementation Engineer.',
            created_at: '2026-03-27T04:04:00.000Z',
          },
        ]),
        scopeLabel: 'Workflow: Release workflow',
        scopeSubject: 'workflow',
        onLoadMore: vi.fn(),
      }),
    );

    expect(html).toContain('flex min-w-0 items-start gap-2');
    expect(html).toContain('border-b border-slate-950/90');
    expect(html).toContain('self-start text-emerald-300');
    expect(html).toContain('min-w-0 flex-1');
    expect(html).toContain('truncate text-slate-100');
    expect(html).toContain('shrink-0 pl-3 text-right text-xs tabular-nums text-slate-500');
    expect(html).toContain('overflow-x-hidden overflow-y-auto');
    expect(html).not.toContain('break-words');
    expect(html).not.toContain('text-left text-xs text-slate-500');
    expect(html).not.toContain('sm:text-right');
    expect(html).not.toContain('grid-cols-[max-content_minmax(0,1fr)_max-content]');
  });

  it('labels live and pause controls so the terminal follow state stays explicit', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowLiveConsole, {
        packet: createPacket([]),
        scopeLabel: 'Workflow: Release workflow',
        scopeSubject: 'workflow',
        onLoadMore: vi.fn(),
      }),
    );

    expect(html).toContain('title="Follow the latest terminal output"');
    expect(html).toContain('title="Pause terminal follow mode"');
    expect(html).toContain('data-state="active"');
    expect(html).toContain('data-state="inactive"');
  });

  it('hides the older-headlines control when no more backfill cursor is available', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowLiveConsole, {
        packet: {
          ...createPacket([]),
          next_cursor: null,
        },
        scopeLabel: 'Workflow: Release workflow',
        scopeSubject: 'workflow',
        onLoadMore: vi.fn(),
      }),
    );

    expect(html).not.toContain('Load older headlines');
    expect(html).not.toContain('Older lines stream in automatically as you scroll upward.');
  });

  it('keeps terminal rows flat while tinting orchestrator and specialist roles differently', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowLiveConsole, {
        packet: createPacket([
          {
            item_id: 'update-1',
            item_kind: 'execution_turn',
            source_kind: 'orchestrator',
            source_label: 'Orchestrator',
            headline: 'Routed policy assessment.',
            summary: 'Routed policy assessment.',
            created_at: '2026-03-27T04:04:00.000Z',
          },
          {
            item_id: 'update-2',
            item_kind: 'execution_turn',
            source_kind: 'specialist',
            source_label: 'Policy Assessor',
            headline: 'Reviewed the intake packet.',
            summary: 'Reviewed the intake packet.',
            created_at: '2026-03-27T04:05:00.000Z',
          },
        ]),
        scopeLabel: 'Workflow: Release workflow',
        scopeSubject: 'workflow',
        onLoadMore: vi.fn(),
      }),
    );

    expect(html).toContain('data-terminal-source="orchestrator"');
    expect(html).toContain('data-terminal-source="specialist"');
    expect(html).toContain('text-sky-300');
    expect(html).toContain('text-emerald-300');
    expect(html).toContain('bg-transparent');
    expect(html).not.toContain('rounded-xl border border-slate-700 bg-slate-950/40 p-4');
  });

  it('suppresses deprecated operator updates from the rendered console and filter counts', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowLiveConsole, {
        packet: createPacket([
          {
            item_id: 'legacy-update-1',
            item_kind: 'operator_update',
            source_label: 'Legacy Writer',
            headline: 'Legacy operator update that should stay hidden.',
            summary: 'Legacy operator update that should stay hidden.',
            created_at: '2026-03-27T04:03:30.000Z',
          },
          {
            item_id: 'turn-1',
            item_kind: 'execution_turn',
            source_label: 'Verifier',
            headline: 'Visible execution turn.',
            summary: 'Visible execution turn.',
            created_at: '2026-03-27T04:04:00.000Z',
          },
        ]),
        scopeLabel: 'Workflow: Release workflow',
        scopeSubject: 'workflow',
        onLoadMore: vi.fn(),
      }),
    );

    expect(html).toContain('Visible execution turn.');
    expect(html).not.toContain('Legacy operator update that should stay hidden.');
    expect(html).toContain('data-live-console-filter-count="1"');
  });

  it('sanitizes literal fallback action rows and suppresses empty helper tool calls', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowLiveConsole, {
        packet: createPacket([
          {
            item_id: 'update-shell',
            item_kind: 'execution_turn',
            source_label: 'Implementation Engineer',
            headline:
              '[Act] calling shell_exec(command="pytest tests/unit", request_id="request-1", task_id="task-1")',
            summary: 'Working through the next execution step.',
            created_at: '2026-03-27T04:05:00.000Z',
          },
          {
            item_id: 'update-empty',
            item_kind: 'execution_turn',
            source_label: 'Implementation Engineer',
            headline: 'calling shell_exec()',
            summary: 'Working through the next execution step.',
            created_at: '2026-03-27T04:04:00.000Z',
          },
          {
            item_id: 'update-helper',
            item_kind: 'execution_turn',
            source_label: 'Implementation Engineer',
            headline: 'calling file_read(path="task input")',
            summary: 'Working through the next execution step.',
            created_at: '2026-03-27T04:03:00.000Z',
          },
        ]),
        scopeLabel: 'Workflow: Release workflow',
        scopeSubject: 'workflow',
        onLoadMore: vi.fn(),
      }),
    );

    expect(html).toContain('calling shell_exec(command=&quot;pytest tests/unit&quot;)');
    expect(html).not.toContain('request_id=');
    expect(html).not.toContain('task_id=');
    expect(html).not.toContain('calling shell_exec()');
    expect(html).toContain('calling file_read(path=&quot;task input&quot;)');
    expect(html).toContain('data-live-console-filter-count="2"');
  });

  it('removes the queued-update affordance from the terminal console source', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, './workflow-live-console.tsx'),
      'utf8',
    );

    expect(source).not.toContain('New updates');
    expect(source).not.toContain('Jump to latest');
  });
});

function createPacket(
  items: Array<
    Partial<DashboardWorkflowLiveConsolePacket['items'][number]> &
      Pick<
        DashboardWorkflowLiveConsolePacket['items'][number],
        'item_id' | 'headline' | 'summary' | 'created_at'
      >
  >,
  options?: {
    includePlatformNotice?: boolean;
  },
): DashboardWorkflowLiveConsolePacket {
  const baseItems: DashboardWorkflowLiveConsolePacket['items'] = items.map((item) => ({
    item_kind: 'execution_turn',
    source_kind: 'specialist',
    source_label: 'Verifier',
    work_item_id: null,
    task_id: null,
    linked_target_ids: [],
    ...item,
  }));
  const allItems: DashboardWorkflowLiveConsolePacket['items'] = options?.includePlatformNotice
    ? [
        ...baseItems,
        {
          item_id: 'notice-1',
          item_kind: 'platform_notice',
          source_kind: 'platform',
          source_label: 'Platform',
          headline: 'Transport retried after reconnect.',
          summary: 'Transport retried after reconnect.',
          created_at: '2026-03-27T04:02:00.000Z',
          work_item_id: null,
          task_id: null,
          linked_target_ids: [],
        },
      ]
    : baseItems;
  return {
    generated_at: '2026-03-27T04:05:00.000Z',
    latest_event_id: 42,
    snapshot_version: 'workflow-operations:42',
    next_cursor: 'cursor-1',
    total_count: 7,
    items: allItems,
  };
}
