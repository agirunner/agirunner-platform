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

    expect(html).toContain('Review the publication package.');
    expect(html).not.toContain('<details');
    expect(html).not.toContain('<summary');
    expect(html).not.toContain('Open brief');
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

    expect(html).toContain('History');
    expect(html).toContain('Policy assessment settled revision 3');
    expect(html).toContain('Revision 3 is internally consistent and ready for the next workflow action.');
    expect(html).not.toContain('Milestone Brief');
    expect(html).not.toContain('Milestone');
    expect(html).not.toContain('Open brief');
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
          scopeSubject: 'work item',
          onLoadMore: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('Policy review sent task 4 back for another revision.');
    expect(html).not.toContain('Open brief');
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
          scopeSubject: 'work item',
          onLoadMore: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('History');
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
          scopeSubject: 'work item',
          onLoadMore: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('Policy Reviewer');
    expect(html).not.toContain('771908c8-0634-467a-b41d-6dd4a6798d7d');
  });

  it('renders the newest brief groups and entries first', () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        undefined,
        createElement(WorkflowHistory, {
          workflowId: 'workflow-1',
          packet: {
            ...createPacket(),
            groups: [
              {
                group_id: '2026-03-26',
                label: '2026-03-26',
                anchor_at: '2026-03-26T00:00:00.000Z',
                item_ids: ['history-older'],
              },
              {
                group_id: '2026-03-27',
                label: '2026-03-27',
                anchor_at: '2026-03-27T00:00:00.000Z',
                item_ids: ['history-middle', 'history-newest'],
              },
            ],
            items: [
              {
                item_id: 'history-older',
                item_kind: 'operator_update',
                source_kind: 'specialist',
                source_label: 'Verifier',
                headline: 'Older headline',
                summary: 'Older summary',
                created_at: '2026-03-26T04:04:00.000Z',
                linked_target_ids: ['workflow-1'],
                work_item_id: null,
                task_id: null,
              },
              {
                item_id: 'history-middle',
                item_kind: 'operator_update',
                source_kind: 'specialist',
                source_label: 'Verifier',
                headline: 'Middle headline',
                summary: 'Middle summary',
                created_at: '2026-03-27T04:04:00.000Z',
                linked_target_ids: ['workflow-1'],
                work_item_id: null,
                task_id: null,
              },
              {
                item_id: 'history-newest',
                item_kind: 'operator_update',
                source_kind: 'specialist',
                source_label: 'Verifier',
                headline: 'Newest headline',
                summary: 'Newest summary',
                created_at: '2026-03-27T04:05:00.000Z',
                linked_target_ids: ['workflow-1'],
                work_item_id: null,
                task_id: null,
              },
            ],
          },
          scopeSubject: 'workflow',
          onLoadMore: vi.fn(),
        }),
      ),
    );

    expect(html.indexOf('2026-03-27')).toBeLessThan(html.indexOf('2026-03-26'));
    expect(html.indexOf('Newest headline')).toBeLessThan(html.indexOf('Middle headline'));
    expect(html.indexOf('Middle headline')).toBeLessThan(html.indexOf('Older headline'));
  });

  it('renders briefs as dense inline rows instead of standalone cards', () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        undefined,
        createElement(WorkflowHistory, {
          workflowId: 'workflow-1',
          packet: createPacket(),
          scopeSubject: 'workflow',
          onLoadMore: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('Approval requested');
    expect(html).toContain('Review the publication package.');
    expect(html).not.toContain('rounded-2xl border border-border/70 bg-background/80 p-4');
  });

  it('shows brief type labels only when multiple visible brief kinds are present', () => {
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
                source_label: 'Reviewer',
                headline: 'Milestone brief headline',
                summary: 'Milestone brief summary',
                created_at: '2026-03-27T04:05:00.000Z',
                linked_target_ids: ['workflow-1'],
                work_item_id: null,
                task_id: null,
              },
              {
                item_id: 'history-2',
                item_kind: 'operator_update',
                source_kind: 'specialist',
                source_label: 'Verifier',
                headline: 'Operator update headline',
                summary: 'Operator update summary',
                created_at: '2026-03-27T04:04:00.000Z',
                linked_target_ids: ['workflow-1'],
                work_item_id: null,
                task_id: null,
              },
            ],
            groups: [
              {
                group_id: '2026-03-27',
                label: '2026-03-27',
                anchor_at: '2026-03-27T00:00:00.000Z',
                item_ids: ['history-1', 'history-2'],
              },
            ],
          },
          scopeSubject: 'workflow',
          onLoadMore: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('Milestone');
    expect(html).toContain('Update');
    expect(html).toContain('Reviewer');
    expect(html).toContain('Verifier');
  });

  it('uses plain inline empty-state copy when no briefs are available', () => {
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
    expect(html).not.toContain('rounded-2xl border border-dashed border-border/70 bg-background/60 p-4');
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
