import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { DashboardWorkflowBoardResponse } from '../../lib/api.js';
import { WorkflowBoard } from './workflow-board.js';

export function renderWorkflowBoard(
  overrides: Partial<ComponentProps<typeof WorkflowBoard>> = {},
): string {
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(WorkflowBoard, {
        workflowId: 'workflow-1',
        board: createBoard(),
        selectedWorkItemId: null,
        boardMode: 'active_recent_complete',
        onBoardModeChange: () => undefined,
        onSelectWorkItem: () => undefined,
        ...overrides,
      }),
    ),
  );
}

export function createBoard(): DashboardWorkflowBoardResponse {
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

export function createBoardWithRecentCompletion(): DashboardWorkflowBoardResponse {
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
        title: 'Completed packet 1',
        priority: 'normal',
        column_id: 'done',
        completed_at: new Date().toISOString(),
        task_count: 3,
      },
      {
        id: 'work-item-3',
        workflow_id: 'workflow-1',
        stage_name: 'intake-triage',
        title: 'Completed packet 2',
        priority: 'normal',
        column_id: 'done',
        completed_at: new Date(Date.now() - 1_000).toISOString(),
        task_count: 2,
      },
      {
        id: 'work-item-4',
        workflow_id: 'workflow-1',
        stage_name: 'intake-triage',
        title: 'Completed packet 3',
        priority: 'normal',
        column_id: 'done',
        completed_at: new Date(Date.now() - 2_000).toISOString(),
        task_count: 2,
      },
      {
        id: 'work-item-5',
        workflow_id: 'workflow-1',
        stage_name: 'intake-triage',
        title: 'Completed packet 4',
        priority: 'normal',
        column_id: 'done',
        completed_at: new Date(Date.now() - 3_000).toISOString(),
        task_count: 1,
      },
    ],
    active_stages: ['intake-triage'],
    awaiting_gate_count: 0,
    stage_summary: [],
  };
}

export function createWideBoard(): DashboardWorkflowBoardResponse {
  return {
    columns: [
      { id: 'backlog', label: 'Backlog' },
      { id: 'planned', label: 'Planned' },
      { id: 'active', label: 'Active' },
      { id: 'blocked', label: 'Blocked', is_blocked: true },
      { id: 'review', label: 'Review' },
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
        stage_name: 'delivery',
        title: 'Completed packet 1',
        priority: 'normal',
        column_id: 'done',
        completed_at: new Date().toISOString(),
        task_count: 1,
      },
    ],
    active_stages: ['intake-triage'],
    awaiting_gate_count: 0,
    stage_summary: [],
  };
}

export function createFourLaneBoard(): DashboardWorkflowBoardResponse {
  return {
    columns: [
      { id: 'planned', label: 'Planned' },
      { id: 'active', label: 'Active' },
      { id: 'blocked', label: 'Blocked', is_blocked: true },
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
