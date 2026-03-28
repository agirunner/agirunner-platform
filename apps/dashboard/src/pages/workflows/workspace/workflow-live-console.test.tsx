import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { DashboardWorkflowLiveConsolePacket } from '../../../lib/api.js';
import { WorkflowLiveConsole } from './workflow-live-console.js';

describe('WorkflowLiveConsole', () => {
  it('renders newest headlines first so the live edge stays at the top', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowLiveConsole, {
        packet: createPacket([
          {
            item_id: 'older',
            headline: 'Older headline',
            summary: 'Older summary',
            created_at: '2026-03-27T04:00:00.000Z',
          },
          {
            item_id: 'newer',
            headline: 'Newest headline',
            summary: 'Newest summary',
            created_at: '2026-03-27T04:05:00.000Z',
          },
        ]),
        selectedWorkItemId: null,
        onLoadMore: vi.fn(),
      }),
    );

    expect(html.indexOf('Newest headline')).toBeLessThan(html.indexOf('Older headline'));
    expect(html).toContain('Load older headlines');
  });

  it('renders milestone briefs distinctly from execution turns', () => {
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
            item_id: 'turn-1',
            item_kind: 'execution_turn',
            source_label: 'Implementation Engineer',
            headline: 'Ran apply patch',
            summary: 'turn 3 · Updated retry handling.',
            created_at: '2026-03-27T04:04:00.000Z',
          },
        ]),
        selectedWorkItemId: null,
        onLoadMore: vi.fn(),
      }),
    );

    expect(html).toContain('Milestone Brief');
    expect(html).toContain('Execution Turn');
    expect(html).toContain('border-emerald-500/20');
    expect(html).toContain('border-sky-500/20');
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
      linked_target_ids: [],
      ...item,
    })),
  };
}
