import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { DashboardWorkflowRailRow } from '../../lib/api.js';
import { WorkflowsRail } from './workflows-rail.js';

describe('WorkflowsRail', () => {
  it('pins the current workflow when filters move it outside the visible rail rows', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowsRail, {
        mode: 'live',
        search: 'filtered',
        needsActionOnly: true,
        ongoingOnly: false,
        rows: [createRailRow({ workflow_id: 'workflow-visible', name: 'Visible workflow' })],
        ongoingRows: [],
        selectedWorkflowId: 'workflow-hidden',
        selectedWorkflowRow: createRailRow({
          workflow_id: 'workflow-hidden',
          name: 'Hidden workflow',
          needs_action: true,
        }),
        hasNextPage: false,
        isLoading: false,
        onModeChange: vi.fn(),
        onSearchChange: vi.fn(),
        onNeedsActionOnlyChange: vi.fn(),
        onShowAllOngoing: vi.fn(),
        onClearOngoingFilter: vi.fn(),
        onSelectWorkflow: vi.fn(),
        onLoadMore: vi.fn(),
        onCreateWorkflow: vi.fn(),
      }),
    );

    expect(html).toContain('Selected workflow');
    expect(html).toContain('Hidden workflow');
    expect(html).not.toContain('outside the current rail view');
    expect(html).not.toContain('stays pinned while you browse other rail results');
  });

  it('treats Needs Action as a filter toggle instead of a second primary mode highlight', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowsRail, {
        mode: 'live',
        search: '',
        needsActionOnly: true,
        ongoingOnly: false,
        rows: [createRailRow({ workflow_id: 'workflow-visible', name: 'Visible workflow' })],
        ongoingRows: [],
        selectedWorkflowId: 'workflow-visible',
        selectedWorkflowRow: null,
        hasNextPage: false,
        isLoading: false,
        onModeChange: vi.fn(),
        onSearchChange: vi.fn(),
        onNeedsActionOnlyChange: vi.fn(),
        onShowAllOngoing: vi.fn(),
        onClearOngoingFilter: vi.fn(),
        onSelectWorkflow: vi.fn(),
        onLoadMore: vi.fn(),
        onCreateWorkflow: vi.fn(),
      }),
    );

    expect(html).toContain('Needs Action Only');
    expect(html).toContain('aria-pressed="true"');
  });

  it('wraps the rail controls instead of forcing horizontal overflow', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowsRail, {
        mode: 'live',
        search: '',
        needsActionOnly: false,
        ongoingOnly: true,
        rows: [createRailRow({ workflow_id: 'workflow-visible', name: 'Visible workflow' })],
        ongoingRows: [],
        selectedWorkflowId: 'workflow-visible',
        selectedWorkflowRow: null,
        hasNextPage: false,
        isLoading: false,
        onModeChange: vi.fn(),
        onSearchChange: vi.fn(),
        onNeedsActionOnlyChange: vi.fn(),
        onShowAllOngoing: vi.fn(),
        onClearOngoingFilter: vi.fn(),
        onSelectWorkflow: vi.fn(),
        onLoadMore: vi.fn(),
        onCreateWorkflow: vi.fn(),
      }),
    );

    expect(html).toContain('flex flex-wrap items-center gap-2');
    expect(html).toContain('overflow-x-hidden');
    expect(html).not.toContain('Select workflow');
  });

  it('does not show a contradictory empty state when pinned ongoing workflows are visible', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowsRail, {
        mode: 'live',
        search: '',
        needsActionOnly: false,
        ongoingOnly: false,
        rows: [],
        ongoingRows: [createRailRow({ workflow_id: 'workflow-ongoing', name: 'Ongoing workflow', lifecycle: 'ongoing' })],
        selectedWorkflowId: 'workflow-ongoing',
        selectedWorkflowRow: null,
        hasNextPage: false,
        isLoading: false,
        onModeChange: vi.fn(),
        onSearchChange: vi.fn(),
        onNeedsActionOnlyChange: vi.fn(),
        onShowAllOngoing: vi.fn(),
        onClearOngoingFilter: vi.fn(),
        onSelectWorkflow: vi.fn(),
        onLoadMore: vi.fn(),
        onCreateWorkflow: vi.fn(),
      }),
    );

    expect(html).toContain('Ongoing');
    expect(html).not.toContain('No workflows match');
    expect(html).not.toContain('rail view');
  });

  it('humanizes the pre-dispatch orchestrator-only state instead of showing fake task counts', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowsRail, {
        mode: 'live',
        search: '',
        needsActionOnly: false,
        ongoingOnly: false,
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
        hasNextPage: false,
        isLoading: false,
        onModeChange: vi.fn(),
        onSearchChange: vi.fn(),
        onNeedsActionOnlyChange: vi.fn(),
        onShowAllOngoing: vi.fn(),
        onClearOngoingFilter: vi.fn(),
        onSelectWorkflow: vi.fn(),
        onLoadMore: vi.fn(),
        onCreateWorkflow: vi.fn(),
      }),
    );

    expect(html).toContain('Orchestrator working');
    expect(html).not.toContain('0 work items');
    expect(html).not.toContain('1 tasks');
  });
});

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
