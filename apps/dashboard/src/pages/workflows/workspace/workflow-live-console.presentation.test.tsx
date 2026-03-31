import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { DashboardWorkflowLiveConsolePacket } from '../../../lib/api.js';
import { WorkflowLiveConsole } from './workflow-live-console.js';

describe('WorkflowLiveConsole presentation', () => {
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

  it('counts operator guidance rows under the steering filter without classifying them as briefs', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowLiveConsole, {
        packet: createPacket([
          {
            item_id: 'steer-1',
            item_kind: 'steering_message',
            source_kind: 'operator',
            source_label: 'Operator',
            headline: 'Pause packaging until the rollback note is updated.',
            summary: 'Operator guidance recorded.',
            created_at: '2026-03-27T04:03:30.000Z',
          },
        ]),
        scopeLabel: 'Workflow: Release workflow',
        scopeSubject: 'workflow',
        onLoadMore: vi.fn(),
      }),
    );

    expect(html).toContain('data-live-console-filter="steering"');
    expect(html).toContain('data-live-console-filter-count="1"');
    expect(html).toContain('Operator:');
    expect(html).toContain('Pause packaging until the rollback note is updated.');
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
