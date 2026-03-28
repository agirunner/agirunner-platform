import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { DashboardWorkflowHistoryPacket } from '../../../lib/api.js';
import { WorkflowHistory } from './workflow-history.js';

describe('WorkflowHistory', () => {
  it('keeps brief detail inline instead of rendering a separate scope navigation action', () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        undefined,
        createElement(WorkflowHistory, {
          workflowId: 'workflow-1',
          packet: createPacket(),
          selectedWorkItemId: 'work-item-1',
          scopeSubject: 'work item',
          onLoadMore: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('Open brief');
    expect(html).not.toContain('Open brief scope');
    expect(html).not.toContain('/workflows/workflow-1?work_item_id=work-item-1&amp;tab=details');
    expect(html).not.toContain('/mission-control/');
    expect(html).not.toContain('/workflow-detail/');
  });

  it('renders milestone briefs as the primary briefs packets', () => {
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
                item_kind: 'milestone_brief',
                source_kind: 'specialist',
                source_label: 'Policy Assessor',
                headline: 'Policy assessment settled revision 3',
                summary: 'Revision 3 is internally consistent and ready for the next workflow action.',
                created_at: '2026-03-27T04:04:00.000Z',
                linked_target_ids: ['workflow-1', 'work-item-1'],
                work_item_id: 'work-item-1',
                task_id: null,
              },
            ],
          },
          selectedWorkItemId: 'work-item-1',
          scopeSubject: 'work item',
          onLoadMore: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('Milestone Brief');
    expect(html).toContain('Briefs');
    expect(html).toContain('Policy assessment settled revision 3');
    expect(html).toContain('Open brief');
    expect(html).not.toContain('Open brief scope');
    expect(html).not.toContain('ordered newest first');
    expect(html).not.toContain('input lineage');
    expect(html).not.toContain('Lifecycle Event');
  });

  it('does not render a separate brief-scope link for task-scoped briefs', () => {
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
                item_kind: 'milestone_brief',
                source_kind: 'specialist',
                source_label: 'Policy Assessor',
                headline: 'Revision 3 still needs owner detail',
                summary: 'Policy review sent task 4 back for another revision.',
                created_at: '2026-03-27T04:04:00.000Z',
                linked_target_ids: ['workflow-1', 'work-item-1', 'task-4'],
                work_item_id: 'work-item-1',
                task_id: 'task-4',
              },
            ],
          },
          selectedTaskId: 'task-4',
          scopeSubject: 'task',
          onLoadMore: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('Open brief');
    expect(html).not.toContain('Open brief scope');
    expect(html).not.toContain('/workflows/workflow-1?work_item_id=work-item-1&amp;task_id=task-4&amp;tab=details');
  });

  it('drops redundant scoped badges because the bottom-pane banner already carries the active scope', () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        undefined,
        createElement(WorkflowHistory, {
          workflowId: 'workflow-1',
          packet: createPacket(),
          selectedWorkItemId: 'work-item-1',
          selectedTaskId: 'task-4',
          scopeSubject: 'task',
          onLoadMore: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('Briefs');
    expect(html).not.toContain('Scoped to selected task');
    expect(html).not.toContain('Scoped to selected work item');
  });

  it('humanizes source badges and hides raw uuid labels in briefs', () => {
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
                item_kind: 'milestone_brief',
                source_kind: 'policy-reviewer',
                source_label: '771908c8-0634-467a-b41d-6dd4a6798d7d',
                headline: 'Revision 3 still needs owner detail',
                summary: 'Policy review sent task 4 back for another revision.',
                created_at: '2026-03-27T04:04:00.000Z',
                linked_target_ids: ['workflow-1', 'work-item-1', 'task-4'],
                work_item_id: 'work-item-1',
                task_id: 'task-4',
              },
            ],
          },
          selectedTaskId: 'task-4',
          scopeSubject: 'task',
          onLoadMore: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('Policy Reviewer');
    expect(html).not.toContain('771908c8-0634-467a-b41d-6dd4a6798d7d');
  });

  it('hides the older-briefs control when no backfill cursor is available', () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        undefined,
        createElement(WorkflowHistory, {
          workflowId: 'workflow-1',
          packet: {
            ...createPacket(),
            next_cursor: null,
            groups: [],
            items: [],
          },
          scopeSubject: 'work item',
          onLoadMore: vi.fn(),
        }),
      ),
    );

    expect(html).not.toContain('Load older briefs');
    expect(html).toContain('No briefs published for this work item yet.');
    expect(html).not.toContain('workflow packets');
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
        work_item_id: 'work-item-1',
        task_id: null,
      },
    ],
  };
}
