import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { DashboardWorkflowLiveConsolePacket } from '../../../lib/api.js';
import { WorkflowLiveConsole } from './workflow-live-console.js';

describe('WorkflowLiveConsole', () => {
  it('preserves the server-provided newest-first order so the live edge stays at the top', () => {
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

    expect(html.indexOf('Newest headline')).toBeLessThan(html.indexOf('Older headline'));
    expect(html).toContain('Load older headlines');
  });

  it('renders updates and briefs as single-line terminal entries', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowLiveConsole, {
        packet: createPacket([
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
            item_kind: 'operator_update',
            source_label: 'Implementation Engineer',
            headline: 'Updated retry handling.',
            summary: 'Execution turn completed for Implementation Engineer.',
            created_at: '2026-03-27T04:04:00.000Z',
          },
        ], { includePlatformNotice: true }),
        scopeLabel: 'Workflow: Release workflow',
        scopeSubject: 'workflow',
        onLoadMore: vi.fn(),
      }),
    );

    expect(html).toContain('All');
    expect(html).toContain('Turn updates');
    expect(html).toContain('Briefs');
    expect(html).toContain('>1<');
    expect(html).toContain('>3<');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('&gt;');
    expect(html).toContain('Implementation Engineer:');
    expect(html).toContain('Updated retry handling.');
    expect(html).not.toContain('Execution turn completed for Implementation Engineer.');
    expect(html).toContain('Orchestrator:');
    expect(html).toContain('Workflow reached approval milestone');
    expect(html).not.toContain('A structured brief was published.');
    expect(html).toContain('Platform:');
    expect(html).toContain('Transport retried after reconnect.');
    expect(html).toContain('Workflow: Release workflow');
    expect(html).toContain('Showing the workflow stream for Workflow: Release workflow.');
    expect(html).toContain('data-terminal-entry="brief"');
    expect(html).toContain('data-terminal-entry="update"');
    expect(html).toContain('data-terminal-entry="notice"');
    expect(html).toContain('border-l-emerald-400/70');
    expect(html).toContain('border-l-slate-700');
    expect(html).toContain('grid gap-1 border-l-2');
    expect(html).toContain('sm:grid-cols-[minmax(0,1fr)_auto]');
    expect(html).toContain('sm:items-start');
    expect(html).toContain('sm:gap-3');
    expect(html).toContain('break-words');
    expect(html).toContain('overflow-x-hidden overflow-y-auto');
    expect(html).toContain(
      'Showing the latest 3 loaded headlines out of 7 total. Filter counts reflect the current window until you load older headlines.',
    );
  });

  it('humanizes role labels and falls back when the provided label is a raw uuid', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowLiveConsole, {
        packet: createPacket([
          {
            item_id: 'update-1',
            item_kind: 'operator_update',
            source_kind: 'specialist',
            source_label: 'implementation_engineer',
            headline: 'Updated retry handling.',
            summary: 'Execution turn completed for implementation engineer.',
            created_at: '2026-03-27T04:04:00.000Z',
          },
          {
            item_id: 'update-2',
            item_kind: 'operator_update',
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

  it('keeps terminal rows readable on narrow screens by wrapping the line and stacking the timestamp', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowLiveConsole, {
        packet: createPacket([
          {
            item_id: 'update-1',
            item_kind: 'operator_update',
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

    expect(html).toContain('min-w-0 break-words text-slate-100');
    expect(html).toContain('text-left text-xs text-slate-500');
    expect(html).toContain('sm:text-right');
    expect(html).toContain('overflow-x-hidden overflow-y-auto');
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
    expect(html).not.toContain('Filter counts reflect the current window until you load older headlines.');
  });
});

function createPacket(
  items: Array<Partial<DashboardWorkflowLiveConsolePacket['items'][number]> & Pick<DashboardWorkflowLiveConsolePacket['items'][number], 'item_id' | 'headline' | 'summary' | 'created_at'>>,
  options?: {
    includePlatformNotice?: boolean;
  },
): DashboardWorkflowLiveConsolePacket {
  const baseItems = items.map((item) => ({
    item_kind: 'operator_update',
    source_kind: 'specialist',
    source_label: 'Verifier',
    work_item_id: null,
    task_id: null,
    linked_target_ids: [],
    ...item,
  }));
  const allItems = options?.includePlatformNotice
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
