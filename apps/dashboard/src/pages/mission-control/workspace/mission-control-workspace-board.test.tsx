import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import type { DashboardWorkflowBoardResponse } from '../../../lib/api.js';
import { MissionControlWorkspaceBoard } from './mission-control-workspace-board.js';

describe('mission control workspace board', () => {
  it('renders work-item-first stage groups with recovery cues and full-workflow deep links', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/mission-control']}>
        <MissionControlWorkspaceBoard
          workflowId="workflow-1"
          board={buildBoard()}
        />
      </MemoryRouter>,
    );

    expect(markup).toContain('Validation');
    expect(markup).toContain('Launch package review');
    expect(markup).toContain('Owner reviewer');
    expect(markup).toContain('Operator should approve launch gate');
    expect(markup).toContain('Open escalation');
    expect(markup).toContain('2 tracked steps');
    expect(markup).toContain('Open full workflow');
  });
});

function buildBoard(): DashboardWorkflowBoardResponse {
  return {
    columns: [
      { id: 'planned', label: 'Planned' },
      { id: 'in_progress', label: 'In Progress' },
      { id: 'blocked', label: 'Blocked', is_blocked: true },
    ],
    work_items: [
      {
        id: 'work-item-1',
        workflow_id: 'workflow-1',
        stage_name: 'validation',
        title: 'Launch package review',
        goal: 'Review the launch packet',
        column_id: 'in_progress',
        owner_role: 'reviewer',
        next_expected_actor: 'Operator',
        next_expected_action: 'Approve launch gate',
        blocked_state: null,
        blocked_reason: null,
        escalation_status: 'open',
        rework_count: 1,
        gate_status: 'awaiting_approval',
        priority: 'high',
        task_count: 2,
        children_count: 1,
      },
    ],
    active_stages: ['validation'],
    awaiting_gate_count: 1,
    stage_summary: [
      {
        name: 'validation',
        goal: 'Validate the launch packet',
        status: 'in_progress',
        is_active: true,
        gate_status: 'awaiting_approval',
        work_item_count: 1,
        open_work_item_count: 1,
        completed_count: 0,
      },
    ],
  };
}
