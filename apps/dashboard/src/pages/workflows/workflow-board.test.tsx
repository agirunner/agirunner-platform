import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import type { DashboardWorkflowBoardResponse } from '../../lib/api.js';
import { WorkflowBoard } from './workflow-board.js';

describe('WorkflowBoard', () => {
  it('keeps board controls in one header row and removes noisy workflow-level board copy', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowBoard, {
          workflowId: 'workflow-1',
          board: createBoard(),
          selectedWorkItemId: null,
          selectedTaskId: null,
          boardMode: 'active_recent_complete',
          onBoardModeChange: vi.fn(),
          onSelectWorkItem: vi.fn(),
          onSelectTask: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('Workflow board');
    expect(html).toContain('All stages');
    expect(html).toContain('All lanes');
    expect(html).not.toContain('Lanes show the actual workflow flow while tasks stay subordinate');
    expect(html).not.toContain('Active stage:');
    expect(html).not.toContain('visible items');
    expect(html).not.toContain('items-center justify-center text-center');
  });

  it('keeps stage context on work items and hides meaningless default priority badges', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowBoard, {
          workflowId: 'workflow-1',
          board: createBoard(),
          selectedWorkItemId: null,
          selectedTaskId: null,
          boardMode: 'active_recent_complete',
          onBoardModeChange: vi.fn(),
          onSelectWorkItem: vi.fn(),
          onSelectTask: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('Intake Triage');
    expect(html).not.toContain('normal');
    expect(html).not.toContain('>Medium<');
    expect(html).not.toContain('visible items');
    expect(html).not.toContain('>1 visible<');
  });

  it('keeps recent completions collapsed by default so they do not consume the active board space', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowBoard, {
          workflowId: 'workflow-1',
          board: createBoardWithRecentCompletion(),
          selectedWorkItemId: null,
          selectedTaskId: null,
          boardMode: 'active_recent_complete',
          onBoardModeChange: vi.fn(),
          onSelectWorkItem: vi.fn(),
          onSelectTask: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('Recent completions');
    expect(html).not.toContain('<details class="rounded-2xl border border-border/70 bg-background/70 p-3" open="">');
    expect(html).not.toContain('>3 tasks<');
    expect(html).not.toContain('No active work is currently visible in this lane.</div>');
  });
});

function createBoard(): DashboardWorkflowBoardResponse {
  return {
    columns: [
      { id: 'planned', label: 'Planned' },
      { id: 'active', label: 'Active' },
      { id: 'done', label: 'Done', is_terminal: true },
    ],
    work_items: [
      {
        id: 'work-item-1',
        workflow_id: 'workflow-1',
        stage_name: 'intake-triage',
        title: 'Review incoming packet',
        priority: 'normal',
        column_id: 'active',
        task_count: 2,
      },
    ],
    active_stages: ['intake-triage'],
    awaiting_gate_count: 0,
    stage_summary: [],
  };
}

function createBoardWithRecentCompletion(): DashboardWorkflowBoardResponse {
  return {
    columns: [
      { id: 'planned', label: 'Planned' },
      { id: 'active', label: 'Active' },
      { id: 'done', label: 'Done', is_terminal: true },
    ],
    work_items: [
      {
        id: 'work-item-1',
        workflow_id: 'workflow-1',
        stage_name: 'intake-triage',
        title: 'Review incoming packet',
        priority: 'normal',
        column_id: 'active',
        task_count: 2,
      },
      {
        id: 'work-item-2',
        workflow_id: 'workflow-1',
        stage_name: 'intake-triage',
        title: 'Completed packet',
        priority: 'normal',
        column_id: 'done',
        completed_at: new Date().toISOString(),
        task_count: 3,
      },
    ],
    active_stages: ['intake-triage'],
    awaiting_gate_count: 0,
    stage_summary: [],
  };
}
