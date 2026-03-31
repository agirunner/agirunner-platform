import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import type {
  DashboardWorkflowBoardResponse,
  DashboardWorkflowStageRecord,
} from '../../lib/api.js';
import { PlaybookBoardCard } from './workflow-detail-board-card.js';

describe('workflow detail board card', () => {
  it('renders grouped milestone work items and move controls without object leakage', () => {
    const markup = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(
          MemoryRouter,
          null,
          createElement(PlaybookBoardCard, {
            workflowId: 'workflow-1',
            board: createBoard(),
            stages: createStages(),
            isLoading: false,
            hasError: false,
            selectedWorkItemId: 'milestone-1',
          }),
        ),
      ),
    );

    expect(markup).toContain('Work Board');
    expect(markup).toContain('Grouped by milestone');
    expect(markup).toContain('Flat board');
    expect(markup).toContain('Focused detail open');
    expect(markup).toContain('Milestone');
    expect(markup).toContain('Draft release notes');
    expect(markup).toContain('Move work item');
    expect(markup).toContain('2/3');
    expect(markup).not.toContain('[object Object]');
  });
});

function createBoard(): DashboardWorkflowBoardResponse {
  return {
    workflow_id: 'workflow-1',
    columns: [
      {
        id: 'active',
        label: 'Active',
        description: 'Currently moving.',
        position: 0,
        item_count: 2,
      },
    ],
    stage_summary: [
      {
        name: 'qa',
        goal: 'Verify the release packet.',
        work_item_count: 3,
        completed_count: 2,
      },
    ],
    work_items: [
      {
        id: 'milestone-1',
        workflow_id: 'workflow-1',
        title: 'Release readiness',
        column_id: 'active',
        priority: 'high',
        stage_name: 'qa',
        is_milestone: true,
        children_count: 1,
        children_completed: 1,
        task_count: 3,
        goal: 'Collect the final release review materials.',
      },
      {
        id: 'child-1',
        workflow_id: 'workflow-1',
        title: 'Draft release notes',
        column_id: 'active',
        priority: 'medium',
        stage_name: 'qa',
        parent_work_item_id: 'milestone-1',
        task_count: 2,
        completed_at: '2026-03-31T00:00:00.000Z',
      },
      {
        id: 'solo-1',
        workflow_id: 'workflow-1',
        title: 'Confirm rollout timing',
        column_id: 'active',
        priority: 'medium',
        stage_name: 'qa',
        task_count: 1,
      },
    ],
  } as DashboardWorkflowBoardResponse;
}

function createStages(): DashboardWorkflowStageRecord[] {
  return [
    {
      id: 'stage-qa',
      workflow_id: 'workflow-1',
      name: 'qa',
      position: 0,
      status: 'in_progress',
      gate_status: 'awaiting_approval',
      summary: 'Release packet is under review.',
      goal: 'Verify the release packet.',
      guidance: 'Inspect the last handoff before approving.',
      iteration_count: 1,
    } as DashboardWorkflowStageRecord,
  ];
}
