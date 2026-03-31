import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { DashboardWorkflowRailRow } from '../../lib/api.js';
import { WorkflowsRail } from './workflows-rail.js';

describe('WorkflowsRail', () => {
  it('shows a loading message before the first rail packet arrives', () => {
    const html = renderRailHtml({
      rows: [],
      ongoingRows: [],
      selectedWorkflowId: null,
      selectedWorkflowRow: null,
      isLoading: true,
    });

    expect(html).toContain('Loading workflows…');
    expect(html).not.toContain('No workflows match the current filters.');
  });

  it('pins the current workflow when filters move it outside the visible rail rows', () => {
    const html = renderRailHtml({
      search: 'filtered',
      needsActionOnly: true,
      rows: [createRailRow({ workflow_id: 'workflow-visible', name: 'Visible workflow' })],
      ongoingRows: [],
      selectedWorkflowId: 'workflow-hidden',
      selectedWorkflowRow: createRailRow({
        workflow_id: 'workflow-hidden',
        name: 'Hidden workflow',
        needs_action: true,
      }),
    });

    expect(html).toContain('Hidden workflow');
    expect(extractRailScrollRegion(html)).toContain('Hidden workflow');
    expect(html).not.toContain('outside the current rail view');
    expect(html).not.toContain('stays pinned while you browse other rail results');
  });

  it('treats Needs Action as a filter toggle instead of a second primary mode highlight', () => {
    const html = renderRailHtml({
      needsActionOnly: true,
      rows: [createRailRow({ workflow_id: 'workflow-visible', name: 'Visible workflow' })],
      ongoingRows: [],
      selectedWorkflowId: 'workflow-visible',
      selectedWorkflowRow: null,
    });

    expect(html).toContain('Needs Action Only');
    expect(html).toContain('aria-pressed="true"');
  });

  it('shows the filtered count summary without pagination affordances when ongoing rows fit in view', () => {
    const html = renderRailHtml({
      ongoingOnly: true,
      lifecycleFilter: 'ongoing',
      visibleCount: 1,
      totalCount: 18,
      rows: [],
      ongoingRows: [createRailRow({ workflow_id: 'workflow-visible', name: 'Visible workflow', lifecycle: 'ongoing' })],
      selectedWorkflowId: 'workflow-visible',
      selectedWorkflowRow: null,
    });

    expect(html).toContain('1 shown · 18 total');
    expect(html).not.toContain('Load more');
    expect(html).not.toContain('Select workflow');
  });

  it('renders a compact active-filter summary without growing the rail width', () => {
    const html = renderRailHtml({
      search: 'release audit',
      needsActionOnly: true,
      ongoingOnly: true,
      lifecycleFilter: 'ongoing',
      visibleCount: 3,
      totalCount: 18,
      rows: [createRailRow({ workflow_id: 'workflow-visible', name: 'Visible workflow' })],
      ongoingRows: [createRailRow({ workflow_id: 'workflow-ongoing', name: 'Workflow ongoing', lifecycle: 'ongoing' })],
      selectedWorkflowId: 'workflow-visible',
      selectedWorkflowRow: null,
    });

    expect(html).toContain('Search: release audit · Needs Action · Ongoing');
    expect(html).not.toContain('rail view');
    expect(html).not.toContain('Showing filters as chips');
  });

  it('summarizes advanced playbook and recency filters in the compact rail header', () => {
    const html = renderRailHtml({
      playbookId: 'playbook-1',
      updatedWithin: '7d',
      playbooks: [{
        id: 'playbook-1',
        name: 'Requirements Review',
        slug: 'requirements-review',
        outcome: 'Review requirements and produce a decision packet.',
        lifecycle: 'planned',
        version: 1,
        definition: {},
      }],
      rows: [createRailRow({ workflow_id: 'workflow-visible', name: 'Visible workflow' })],
      selectedWorkflowId: 'workflow-visible',
    });

    expect(html).toContain('Filters (2)');
    expect(html).toContain('Playbook: Requirements Review · Updated 7d');
  });

  it('does not show a contradictory empty state when pinned ongoing workflows are visible', () => {
    const html = renderRailHtml({
      visibleCount: 0,
      totalCount: 0,
      rows: [],
      ongoingRows: [createRailRow({ workflow_id: 'workflow-ongoing', name: 'Ongoing workflow', lifecycle: 'ongoing' })],
      selectedWorkflowId: 'workflow-ongoing',
      selectedWorkflowRow: null,
    });

    expect(html).toContain('Ongoing');
    expect(html).not.toContain('No workflows match');
    expect(html).not.toContain('rail view');
  });

  it('humanizes the pre-dispatch orchestrator-only state instead of showing fake task counts', () => {
    const html = renderRailHtml({
      rows: [createRailRow({
        workflow_id: 'workflow-initializing',
        name: 'Initializing workflow',
        counts: {
          active_task_count: 1,
          active_work_item_count: 0,
          blocked_work_item_count: 0,
          open_escalation_count: 0,
          waiting_for_decision_count: 0,
          failed_task_count: 0,
        },
      })],
      ongoingRows: [],
      selectedWorkflowId: 'workflow-initializing',
      selectedWorkflowRow: null,
    });

    expect(html).toContain('Orchestrator working');
    expect(html).not.toContain('0 work items');
    expect(html).not.toContain('1 tasks');
    expect(html).not.toContain('Working through the current lane.');
  });

  it('shows routing language when an ongoing workflow is waiting without specialist tasks', () => {
    const html = renderRailHtml({
      rows: [],
      ongoingRows: [createRailRow({
        workflow_id: 'workflow-routing',
        name: 'Routing workflow',
        lifecycle: 'ongoing',
        posture: 'waiting_by_design',
        counts: {
          active_task_count: 0,
          active_work_item_count: 0,
          blocked_work_item_count: 0,
          open_escalation_count: 0,
          waiting_for_decision_count: 0,
          failed_task_count: 0,
        },
      })],
      selectedWorkflowId: 'workflow-routing',
      selectedWorkflowRow: null,
    });

    expect(html).toContain('Routing next step');
    expect(html).toContain('Waiting for Work');
    expect(html).not.toContain('0 work items');
    expect(html).not.toContain('Awaiting Intake');
    expect(html).not.toContain('Working through the current lane.');
  });

  it('pins a selected ongoing workflow when it falls outside the capped ongoing preview', () => {
    const html = renderRailHtml({
      visibleCount: 0,
      totalCount: 6,
      rows: [],
      ongoingRows: [
        createRailRow({ workflow_id: 'workflow-1', name: 'Workflow 1', lifecycle: 'ongoing' }),
        createRailRow({ workflow_id: 'workflow-2', name: 'Workflow 2', lifecycle: 'ongoing' }),
        createRailRow({ workflow_id: 'workflow-3', name: 'Workflow 3', lifecycle: 'ongoing' }),
        createRailRow({ workflow_id: 'workflow-4', name: 'Workflow 4', lifecycle: 'ongoing' }),
        createRailRow({ workflow_id: 'workflow-5', name: 'Workflow 5', lifecycle: 'ongoing' }),
        createRailRow({ workflow_id: 'workflow-selected', name: 'Workflow Selected', lifecycle: 'ongoing' }),
      ],
      selectedWorkflowId: 'workflow-selected',
      selectedWorkflowRow: createRailRow({
        workflow_id: 'workflow-selected',
        name: 'Workflow Selected',
        lifecycle: 'ongoing',
      }),
    });

    expect(html).toContain('Workflow Selected');
  });

  it('renders ongoing rows when the operator filters to ongoing workflows only', () => {
    const html = renderRailHtml({
      ongoingOnly: true,
      lifecycleFilter: 'ongoing',
      visibleCount: 1,
      totalCount: 6,
      rows: [],
      ongoingRows: [
        createRailRow({
          workflow_id: 'workflow-ongoing',
          name: 'Workflow Ongoing',
          lifecycle: 'ongoing',
        }),
      ],
      selectedWorkflowId: 'workflow-ongoing',
      selectedWorkflowRow: createRailRow({
        workflow_id: 'workflow-ongoing',
        name: 'Workflow Ongoing',
        lifecycle: 'ongoing',
      }),
    });

    expect(html).toContain('Workflow Ongoing');
    expect(html).not.toContain('No workflows match');
    expect(html).not.toContain('Selected workflow');
  });
});

function renderRailHtml(
  overrides: Partial<Parameters<typeof WorkflowsRail>[0]>,
): string {
  return renderToStaticMarkup(
    createElement(WorkflowsRail, {
      mode: 'live',
      search: '',
      needsActionOnly: false,
      lifecycleFilter: 'all',
      playbookId: null,
      updatedWithin: 'all',
      ongoingOnly: false,
      visibleCount: 0,
      totalCount: 0,
      rows: [],
      ongoingRows: [],
      playbooks: [],
      selectedWorkflowId: null,
      selectedWorkflowRow: null,
      hasNextPage: false,
      isLoading: false,
      onModeChange: vi.fn(),
      onLifecycleFilterChange: vi.fn(),
      onPlaybookFilterChange: vi.fn(),
      onSearchChange: vi.fn(),
      onNeedsActionOnlyChange: vi.fn(),
      onUpdatedWithinChange: vi.fn(),
      onShowAllOngoing: vi.fn(),
      onClearOngoingFilter: vi.fn(),
      onSelectWorkflow: vi.fn(),
      onLoadMore: vi.fn(),
      onCreateWorkflow: vi.fn(),
      ...overrides,
    }),
  );
}

function createRailRow(
  overrides: Partial<DashboardWorkflowRailRow> & Pick<DashboardWorkflowRailRow, 'workflow_id' | 'name'>,
): DashboardWorkflowRailRow {
  const { workflow_id, name, ...rest } = overrides;
  return {
    workflow_id,
    name,
    state: 'active',
    lifecycle: 'planned',
    current_stage: null,
    workspace_name: 'Workspace',
    playbook_name: 'Playbook',
    posture: 'progressing',
    live_summary: 'Working through the current lane.',
    last_changed_at: new Date().toISOString(),
    needs_action: false,
    counts: {
      active_task_count: 1,
      active_work_item_count: 1,
      blocked_work_item_count: 0,
      open_escalation_count: 0,
      waiting_for_decision_count: 0,
      failed_task_count: 0,
    },
    ...rest,
  };
}

function extractRailScrollRegion(html: string): string {
  const marker = 'data-workflows-rail-scroll-region="true"';
  const startIndex = html.indexOf(marker);
  if (startIndex < 0) {
    return '';
  }
  return html.slice(startIndex);
}
