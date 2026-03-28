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
        selectedWorkItemId: null,
        selectedTaskId: null,
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
        ]),
        selectedWorkItemId: null,
        selectedTaskId: null,
        scopeSubject: 'workflow',
        onLoadMore: vi.fn(),
      }),
    );

    expect(html).toContain('&gt;');
    expect(html).toContain('Implementation Engineer:');
    expect(html).toContain('Updated retry handling.');
    expect(html).not.toContain('Execution turn completed for Implementation Engineer.');
    expect(html).toContain('Orchestrator:');
    expect(html).toContain('Workflow reached approval milestone');
    expect(html).not.toContain('A structured brief was published.');
    expect(html).not.toContain('[brief]');
    expect(html).not.toContain('border-sky-500/20');
    expect(html).toContain('grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3');
    expect(html).toContain('whitespace-nowrap');
  });

  it('shows task scope explicitly when a task is selected', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowLiveConsole, {
        packet: createPacket([]),
        selectedWorkItemId: 'work-item-1',
        selectedTaskId: 'task-1',
        scopeSubject: 'task',
        onLoadMore: vi.fn(),
      }),
    );

    expect(html).toContain('Scoped to selected task');
    expect(html).not.toContain('Scoped to selected work item');
    expect(html).toContain('No live headlines have been recorded for this task yet.');
    expect(html).not.toContain('this workflow yet');
  });

  it('hides the older-headlines control when no more backfill cursor is available', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowLiveConsole, {
        packet: {
          ...createPacket([]),
          next_cursor: null,
        },
        selectedWorkItemId: null,
        selectedTaskId: null,
        scopeSubject: 'workflow',
        onLoadMore: vi.fn(),
      }),
    );

    expect(html).not.toContain('Load older headlines');
  });
});

function createPacket(
  items: Array<Partial<DashboardWorkflowLiveConsolePacket['items'][number]> & Pick<DashboardWorkflowLiveConsolePacket['items'][number], 'item_id' | 'headline' | 'summary' | 'created_at'>>,
): DashboardWorkflowLiveConsolePacket {
  return {
    generated_at: '2026-03-27T04:05:00.000Z',
    latest_event_id: 42,
    snapshot_version: 'workflow-operations:42',
    next_cursor: 'cursor-1',
    items: items.map((item) => ({
      item_kind: 'operator_update',
      source_kind: 'specialist',
      source_label: 'Verifier',
      work_item_id: null,
      task_id: null,
      linked_target_ids: [],
      ...item,
    })),
  };
}
