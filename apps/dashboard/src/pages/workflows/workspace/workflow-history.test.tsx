import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { DashboardWorkflowHistoryPacket } from '../../../lib/api.js';
import { WorkflowHistory } from './workflow-history.js';

describe('WorkflowHistory', () => {
  it('keeps history links inside the Workflows shell instead of legacy workflow-detail routes', () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        undefined,
        createElement(WorkflowHistory, {
          workflowId: 'workflow-1',
          packet: createPacket(),
          selectedWorkItemId: 'work-item-1',
          onLoadMore: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('/workflows/workflow-1?work_item_id=work-item-1&amp;tab=history');
    expect(html).not.toContain('/mission-control/');
    expect(html).not.toContain('/workflow-detail/');
  });

  it('renders lifecycle events as distinct history packets', () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        undefined,
        createElement(WorkflowHistory, {
          workflowId: 'workflow-1',
          packet: {
            ...createPacket(),
            items: [
              {
                item_id: 'history-1',
                item_kind: 'lifecycle_event',
                source_kind: 'implementation_engineer',
                source_label: 'Implementation Engineer',
                headline: 'Implementation Engineer started Implement change',
                summary: 'action Task Started · via workflow_runner',
                created_at: '2026-03-27T04:04:00.000Z',
                linked_target_ids: ['workflow-1', 'work-item-1'],
              },
            ],
          },
          selectedWorkItemId: 'work-item-1',
          onLoadMore: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('Lifecycle Event');
    expect(html).toContain('Implementation Engineer started Implement change');
  });
});

function createPacket(): DashboardWorkflowHistoryPacket {
  return {
    generated_at: '2026-03-27T04:05:00.000Z',
    latest_event_id: 42,
    snapshot_version: 'workflow-operations:42',
    next_cursor: 'cursor-1',
    groups: [
      {
        group_id: '2026-03-27',
        label: '2026-03-27',
        anchor_at: '2026-03-27T00:00:00.000Z',
        item_ids: ['history-1'],
      },
    ],
    filters: {
      available: ['updates', 'briefs'],
      active: [],
    },
    items: [
      {
        item_id: 'history-1',
        item_kind: 'operator_update',
        source_kind: 'specialist',
        source_label: 'Verifier',
        headline: 'Approval requested',
        summary: 'Review the publication package.',
        created_at: '2026-03-27T04:04:00.000Z',
        linked_target_ids: ['workflow-1', 'work-item-1'],
      },
    ],
  };
}
