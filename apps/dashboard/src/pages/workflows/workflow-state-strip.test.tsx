import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import type {
  DashboardMissionControlWorkflowCard,
  DashboardWorkflowBoardResponse,
  DashboardWorkflowStickyStrip,
} from '../../lib/api.js';
import { WorkflowStateStrip } from './workflow-state-strip.js';

describe('WorkflowStateStrip', () => {
  it('shows active stage posture and workload shape from the board', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowStateStrip, {
          workflow: createWorkflowCard(),
          stickyStrip: createStickyStrip(),
          workflowSettings: null,
          board: createBoard(),
          selectedScopeLabel: null,
          onTabChange: vi.fn(),
          onAddWork: vi.fn(),
          onVisibilityModeChange: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('Active stage: Approval Gate');
    expect(html).toContain('2 completed work items');
    expect(html).toContain('1 active work item');
  });
});

function createWorkflowCard(): DashboardMissionControlWorkflowCard {
  return {
    id: 'workflow-1',
    name: 'Workflow 1',
    state: 'active',
    lifecycle: 'ongoing',
    currentStage: 'approval-gate',
    workspaceId: 'workspace-1',
    workspaceName: 'Workspace',
    playbookId: 'playbook-1',
    playbookName: 'Playbook',
    posture: 'progressing',
    attentionLane: 'watchlist',
    pulse: {
      summary: 'The workflow is currently progressing through approval.',
      tone: 'progressing',
      updatedAt: new Date().toISOString(),
    },
    outputDescriptors: [],
    availableActions: [],
    metrics: {
      activeTaskCount: 3,
      activeWorkItemCount: 1,
      blockedWorkItemCount: 0,
      openEscalationCount: 0,
      waitingForDecisionCount: 1,
      failedTaskCount: 0,
      recoverableIssueCount: 0,
      lastChangedAt: new Date().toISOString(),
    },
    version: {
      generatedAt: new Date().toISOString(),
      latestEventId: 1,
      token: 'token-1',
    },
  };
}

function createStickyStrip(): DashboardWorkflowStickyStrip {
  return {
    workflow_id: 'workflow-1',
    workflow_name: 'Workflow 1',
    posture: 'progressing',
    summary: 'Approval stage is active with one work item in motion.',
    approvals_count: 1,
    escalations_count: 0,
    blocked_work_item_count: 0,
    active_task_count: 3,
    active_work_item_count: 1,
    steering_available: true,
  };
}

function createBoard(): DashboardWorkflowBoardResponse {
  return {
    columns: [
      { id: 'active', label: 'Active' },
      { id: 'done', label: 'Done', is_terminal: true },
    ],
    work_items: [
      {
        id: 'active-item',
        workflow_id: 'workflow-1',
        stage_name: 'approval-gate',
        title: 'Approval gate work',
        priority: 'high',
        column_id: 'active',
      },
      {
        id: 'done-item-1',
        workflow_id: 'workflow-1',
        stage_name: 'drafting',
        title: 'Drafting work',
        priority: 'medium',
        column_id: 'done',
        completed_at: new Date().toISOString(),
      },
      {
        id: 'done-item-2',
        workflow_id: 'workflow-1',
        stage_name: 'triage',
        title: 'Triage work',
        priority: 'medium',
        column_id: 'done',
        completed_at: new Date().toISOString(),
      },
    ],
    active_stages: ['approval-gate'],
    awaiting_gate_count: 1,
    stage_summary: [],
  };
}
