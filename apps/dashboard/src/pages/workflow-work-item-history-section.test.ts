import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

function readSource() {
  return [
    './workflow-work-item-history-section.tsx',
    './workflow-work-item-history-controls.tsx',
    './workflow-work-item-history-entry.tsx',
  ]
    .map((path) => readFileSync(resolve(import.meta.dirname, path), 'utf8'))
    .join('\n');
}

afterEach(() => {
  vi.doUnmock('./workflow-work-item-history-support.js');
  vi.resetModules();
});

describe('workflow work-item history section source', () => {
  it('renders operator history packets with overview metrics and linked-step diagnostics', () => {
    const source = readSource();

    expect(source).toContain('buildWorkItemHistoryOverview(filteredEvents)');
    expect(source).toContain('buildWorkItemHistoryRecords(props.events)');
    expect(source).toContain('filterAndSortWorkItemHistoryRecords');
    expect(source).toContain('paginateWorkItemHistoryRecords');
    expect(source).toContain('Latest operator signal');
    expect(source).toContain('overview.metrics.map((metric) =>');
    expect(source).toContain('SavedViews');
    expect(source).toContain('Search activity, stages, steps, actors, work items, or signal labels');
    expect(source).toContain('Needs attention');
    expect(source).toContain('Attention first');
    expect(source).toContain('Showing {start}-{end} of {props.visibleCount} visible events.');
    expect(source).toContain('WORK_ITEM_HISTORY_PAGE_SIZE');
    expect(source).toContain('data-testid="work-item-history-list"');
    expect(source).toContain('Stay in the work-item flow first');
    expect(source).toContain('Open linked step diagnostics');
    expect(source).toContain('Operator decision packet');
    expect(source).toContain('Open full event payload');
  });

  it('serializes object-valued event history fields instead of rendering raw objects', async () => {
    vi.doMock('./workflow-work-item-history-support.js', () => ({
      buildWorkItemHistoryOverview: (events: Array<{ data?: Record<string, unknown> }>) => ({
        focusLabel: events[0]?.data?.status_label ?? { label: 'Needs review' },
        focusTone: 'warning',
        focusDetail: events[0]?.data?.focus_detail ?? { message: 'Inspect the gate packet first.' },
        metrics: [
          {
            label: events[0]?.data?.metric_label ?? { label: 'Activity packets' },
            value: events[0]?.data?.metric_value ?? { count: 3 },
            detail: events[0]?.data?.metric_detail ?? { message: 'Newest activity is listed first.' },
          },
        ],
      }),
      buildWorkItemHistoryPacket: (event: { data?: Record<string, unknown> }) => ({
        id: 'event-1',
        headline: event.data?.headline ?? { title: 'Gate review requested' },
        summary: event.data?.summary ?? { message: 'Operator approval is required.' },
        scopeSummary: event.data?.scope_summary ?? { label: 'Stage qa' },
        emphasisLabel: event.data?.emphasis_label ?? { label: 'Gate review' },
        emphasisTone: 'warning',
        signalBadges: event.data?.signal_badges ?? [{ label: 'awaiting review' }, { name: 'qa' }],
        stageName: event.data?.stage_badge ?? { name: 'qa' },
        workItemId: event.data?.work_item_badge ?? { id: 'workitem-12345678' },
        taskId: event.data?.task_badge ?? { id: 'task-abcdef12' },
        actor: event.data?.actor_badge ?? { label: 'Agent agent-7' },
        createdAtLabel: event.data?.created_label ?? { label: '5m ago' },
        createdAtTitle: event.data?.created_title ?? { label: '2026-03-13T00:00:00Z' },
        payload: event.data?.payload ?? {
          recommendation: {
            summary: 'Hold for operator sign-off',
          },
        },
      }),
    }));

    const { WorkItemEventHistorySection } = await import('./workflow-work-item-history-section.js');
    const markup = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(WorkItemEventHistorySection, {
          workflowId: 'workflow-1',
          workItemId: 'workitem-12345678',
          isLoading: false,
          hasError: false,
          events: [
            {
              id: 'event-1',
              type: 'stage.gate_requested',
              entity_type: 'work_item',
              entity_id: 'workitem-12345678',
              actor_type: 'agent',
              actor_id: 'agent-7',
              created_at: '2026-03-13T00:00:00Z',
              data: {
                status_label: { label: 'Needs review' },
                focus_detail: { message: 'Inspect the gate packet first.' },
                metric_label: { label: 'Activity packets' },
                metric_value: { count: 3 },
                metric_detail: { message: 'Newest activity is listed first.' },
                headline: { title: 'Gate review requested' },
                summary: { message: 'Operator approval is required.' },
                scope_summary: { label: 'Stage qa' },
                emphasis_label: { label: 'Gate review' },
                signal_badges: [{ label: 'awaiting review' }, { name: 'qa' }],
                stage_badge: { name: 'qa' },
                work_item_badge: { id: 'workitem-12345678' },
                task_badge: { id: 'task-abcdef12' },
                actor_badge: { label: 'Agent agent-7' },
                created_label: { label: '5m ago' },
                created_title: { label: '2026-03-13T00:00:00Z' },
                payload: {
                  recommendation: {
                    summary: 'Hold for operator sign-off',
                  },
                },
              },
            },
          ],
        }),
      ),
    );

    expect(markup).toContain('Needs review');
    expect(markup).toContain('Inspect the gate packet first.');
    expect(markup).toContain('Gate review requested');
    expect(markup).toContain('Operator approval is required.');
    expect(markup).toContain('Gate review');
    expect(markup).toContain('awaiting review');
    expect(markup).toContain('5m ago');
    expect(markup).toContain('work item workitem');
    expect(markup).not.toContain('[object Object]');
  });

  it('normalizes malformed structured payload summaries before rendering the review packet', async () => {
    vi.doMock('./workflow-work-item-history-support.js', () => ({
      buildWorkItemHistoryOverview: () => ({
        focusLabel: 'Gate review',
        focusTone: 'warning',
        focusDetail: 'Inspect the event payload.',
        metrics: [],
      }),
      buildWorkItemHistoryPacket: (event: { data?: Record<string, unknown> }) => ({
        id: 'event-2',
        headline: 'Gate review requested',
        summary: 'Operator approval is required.',
        scopeSummary: 'Stage qa',
        emphasisLabel: 'Gate review',
        emphasisTone: 'warning',
        signalBadges: ['awaiting review'],
        stageName: 'qa',
        workItemId: 'workitem-12345678',
        taskId: 'task-abcdef12',
        actor: 'Agent agent-7',
        createdAtLabel: '5m ago',
        createdAtTitle: '2026-03-13T00:00:00Z',
        payload: event.data?.payload ?? {},
      }),
    }));
    vi.doMock('./workflow-work-item-detail-support.js', async () => {
      const actual = await vi.importActual<typeof import('./workflow-work-item-detail-support.js')>(
        './workflow-work-item-detail-support.js',
      );
      return {
        ...actual,
        summarizeStructuredValue: () => ({
          hasValue: true,
          shapeLabel: { label: 'Structured payload' },
          detail: { message: 'Review nested recommendation details.' },
          keyHighlights: [{ label: 'Recommendation' }, { name: 'Needs approval' }],
          scalarFacts: [
            {
              label: { label: 'Primary reason' },
              value: { message: 'Hold for operator sign-off' },
            },
          ],
        }),
      };
    });

    const { WorkItemEventHistorySection } = await import('./workflow-work-item-history-section.js');
    const markup = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(WorkItemEventHistorySection, {
          workflowId: 'workflow-1',
          workItemId: 'workitem-12345678',
          isLoading: false,
          hasError: false,
          events: [
            {
              id: 'event-2',
              type: 'stage.gate_requested',
              entity_type: 'work_item',
              entity_id: 'workitem-12345678',
              actor_type: 'agent',
              actor_id: 'agent-7',
              created_at: '2026-03-13T00:00:00Z',
              data: {
                payload: {
                  recommendation: {
                    summary: 'Hold for operator sign-off',
                  },
                },
              },
            },
          ],
        }),
      ),
    );

    expect(markup).toContain('Structured payload');
    expect(markup).toContain('Review nested recommendation details.');
    expect(markup).toContain('Primary reason');
    expect(markup).toContain('Hold for operator sign-off');
    expect(markup).toContain('Recommendation');
    expect(markup).toContain('Needs approval');
    expect(markup).not.toContain('[object Object]');
  });
});
