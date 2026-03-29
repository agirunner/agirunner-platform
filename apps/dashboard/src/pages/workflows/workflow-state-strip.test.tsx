import { readFileSync } from 'node:fs';
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
  it('renders the add-work CTA from a passed label instead of a hardcoded generic header label', () => {
    const source = readFileSync(new URL('./workflow-state-strip.tsx', import.meta.url), 'utf8');

    expect(source).toContain('props.addWorkLabel');
    expect(source).not.toContain('Add / Modify Work');
  });

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
          onOpenRedrive: vi.fn(),
          onVisibilityModeChange: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('Work Items');
    expect(html).toContain('2 completed');
    expect(html).toContain('Specialist Tasks');
    expect(html).toContain('Steering');
    expect(html).toContain('3 active tasks');
    expect(html).toContain('Live visibility');
    expect(html).not.toContain('Playbook');
    expect(html).not.toContain('Workspace');
  });

  it('uses singular workload grammar when only one specialist task is active', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowStateStrip, {
          workflow: createWorkflowCard({
            metrics: {
              ...createWorkflowCard().metrics,
              activeTaskCount: 1,
            },
          }),
          stickyStrip: createStickyStrip({
            active_task_count: 1,
          }),
          workflowSettings: null,
          board: createBoard(),
          selectedScopeLabel: null,
          onTabChange: vi.fn(),
          onAddWork: vi.fn(),
          onOpenRedrive: vi.fn(),
          onVisibilityModeChange: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('1 active task');
    expect(html).not.toContain('1 active tasks');
  });

  it('keeps the sticky cards compact and uses operator-friendly workflow badges', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowStateStrip, {
          workflow: createWorkflowCard({
            lifecycle: 'ongoing',
            currentStage: null,
            posture: 'waiting_by_design',
            metrics: {
              ...createWorkflowCard().metrics,
              activeTaskCount: 0,
              activeWorkItemCount: 0,
            },
          }),
          stickyStrip: createStickyStrip({
            posture: 'waiting_by_design',
            active_task_count: 0,
            active_work_item_count: 0,
          }),
          workflowSettings: null,
          board: createBoard(),
          selectedScopeLabel: 'workflows-intake-01',
          onTabChange: vi.fn(),
          onAddWork: vi.fn(),
          onOpenRedrive: vi.fn(),
          onVisibilityModeChange: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('Waiting for Work');
    expect(html).toContain('Ongoing');
    expect(html).toContain('Routing next step');
    expect(html).toContain('Specialist Tasks');
    expect(html).toContain('Work Items');
    expect(html).toContain('Steering');
    expect(html).not.toContain('Waiting By Design');
    expect(html).not.toContain('Workflow is waiting by design');
    expect(html).not.toContain('Awaiting Intake');
    expect(html).toContain('Live visibility');
    expect(html).not.toContain('rounded-2xl border border-border/70 bg-background/95 p-3 shadow-sm');
    expect(html).not.toContain('shadow-sm');
    expect(html).not.toContain('rounded-xl border border-border/70 bg-muted/5 px-2.5 py-2 text-left shadow-none');
    expect(html).not.toContain('label class="flex items-center gap-2 rounded-xl border border-border/70 bg-muted/10 px-2.5 py-1.5 text-[11px] text-muted-foreground"');
    expect(html).not.toContain('Requests and responses');
    expect(html).not.toContain('<p class="text-xs text-muted-foreground">Playbook • Workspace</p>');
    expect(html).not.toContain('Accepting new work');
  });

  it('shows the selected workbench scope in the workflow overview card when a narrower slice is focused', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowStateStrip, {
          workflow: createWorkflowCard(),
          stickyStrip: createStickyStrip(),
          workflowSettings: null,
          board: createBoard(),
          selectedScopeLabel: 'Verify release candidate',
          onTabChange: vi.fn(),
          onAddWork: vi.fn(),
          onOpenRedrive: vi.fn(),
          onVisibilityModeChange: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('Workbench scope');
    expect(html).toContain('Verify release candidate');
  });

  it('shows add-or-modify-work only when the platform marks it legal', () => {
    const hiddenHtml = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowStateStrip, {
          workflow: createWorkflowCard({
            availableActions: [
              {
                kind: 'pause_workflow',
                scope: 'workflow',
                enabled: true,
                confirmationLevel: 'immediate',
                stale: false,
                disabledReason: null,
              },
              {
                kind: 'add_work_item',
                scope: 'workflow',
                enabled: false,
                confirmationLevel: 'standard_confirm',
                stale: false,
                disabledReason: 'Action is not available in the current workflow state.',
              },
            ],
          }),
          stickyStrip: createStickyStrip(),
          workflowSettings: null,
          board: createBoard(),
          selectedScopeLabel: null,
          onTabChange: vi.fn(),
          onAddWork: vi.fn(),
          onOpenRedrive: vi.fn(),
          onVisibilityModeChange: vi.fn(),
        }),
      ),
    );

    const visibleHtml = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowStateStrip, {
          workflow: createWorkflowCard({
            availableActions: [
              {
                kind: 'pause_workflow',
                scope: 'workflow',
                enabled: true,
                confirmationLevel: 'immediate',
                stale: false,
                disabledReason: null,
              },
              {
                kind: 'add_work_item',
                scope: 'workflow',
                enabled: true,
                confirmationLevel: 'standard_confirm',
                stale: false,
                disabledReason: null,
              },
            ],
          }),
          stickyStrip: createStickyStrip(),
          workflowSettings: null,
          board: createBoard(),
          selectedScopeLabel: null,
          onTabChange: vi.fn(),
          onAddWork: vi.fn(),
          onOpenRedrive: vi.fn(),
          onVisibilityModeChange: vi.fn(),
        }),
      ),
    );

    expect(hiddenHtml).not.toContain('Add Intake');
    expect(visibleHtml).toContain('Add Intake');
  });

  it('defaults the header CTA to Add Work for planned workflows when no scope-specific label is passed', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowStateStrip, {
          workflow: createWorkflowCard({
            lifecycle: 'planned',
            availableActions: [
              {
                kind: 'add_work_item',
                scope: 'workflow',
                enabled: true,
                confirmationLevel: 'standard_confirm',
                stale: false,
                disabledReason: null,
              },
            ],
          }),
          stickyStrip: createStickyStrip(),
          workflowSettings: null,
          board: createBoard(),
          selectedScopeLabel: null,
          onTabChange: vi.fn(),
          onAddWork: vi.fn(),
          onOpenRedrive: vi.fn(),
          onVisibilityModeChange: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('Add Work');
    expect(html).not.toContain('Add Intake');
  });

  it('keeps workflow header actions hidden when the platform only authorizes narrower scopes', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowStateStrip, {
          workflow: createWorkflowCard({
            availableActions: [
              {
                kind: 'pause_workflow',
                scope: 'task',
                enabled: true,
                confirmationLevel: 'immediate',
                stale: false,
                disabledReason: null,
              },
              {
                kind: 'cancel_workflow',
                scope: 'work_item',
                enabled: true,
                confirmationLevel: 'high_impact_confirm',
                stale: false,
                disabledReason: null,
              },
              {
                kind: 'redrive_workflow',
                scope: 'task',
                enabled: true,
                confirmationLevel: 'high_impact_confirm',
                stale: false,
                disabledReason: null,
              },
              {
                kind: 'add_work_item',
                scope: 'work_item',
                enabled: true,
                confirmationLevel: 'standard_confirm',
                stale: false,
                disabledReason: null,
              },
            ],
          }),
          stickyStrip: createStickyStrip(),
          workflowSettings: null,
          board: createBoard(),
          selectedScopeLabel: 'Task: Verify deliverable',
          onTabChange: vi.fn(),
          onAddWork: vi.fn(),
          onOpenRedrive: vi.fn(),
          onVisibilityModeChange: vi.fn(),
        }),
      ),
    );

    expect(html).not.toContain('Pause');
    expect(html).not.toContain('Cancel');
    expect(html).not.toContain('Redrive');
    expect(html).not.toContain('Add / Modify Work');
  });

  it('shows Resume instead of Pause for paused workflows and hides Resume once the workflow is cancelled', () => {
    const pausedHtml = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowStateStrip, {
          workflow: createWorkflowCard({
            state: 'paused',
            posture: 'paused',
            availableActions: [
              {
                kind: 'pause_workflow',
                scope: 'workflow',
                enabled: false,
                confirmationLevel: 'immediate',
                stale: false,
                disabledReason: 'Only active workflows can be paused.',
              },
              {
                kind: 'resume_workflow',
                scope: 'workflow',
                enabled: true,
                confirmationLevel: 'immediate',
                stale: false,
                disabledReason: null,
              },
              {
                kind: 'cancel_workflow',
                scope: 'workflow',
                enabled: true,
                confirmationLevel: 'high_impact_confirm',
                stale: false,
                disabledReason: null,
              },
            ],
          }),
          stickyStrip: createStickyStrip({ posture: 'paused' }),
          workflowSettings: null,
          board: createBoard(),
          selectedScopeLabel: null,
          onTabChange: vi.fn(),
          onAddWork: vi.fn(),
          onOpenRedrive: vi.fn(),
          onVisibilityModeChange: vi.fn(),
        }),
      ),
    );
    const cancelledHtml = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowStateStrip, {
          workflow: createWorkflowCard({
            state: 'cancelled',
            posture: 'cancelled',
            availableActions: [
              {
                kind: 'pause_workflow',
                scope: 'workflow',
                enabled: false,
                confirmationLevel: 'immediate',
                stale: false,
                disabledReason: 'Only active workflows can be paused.',
              },
              {
                kind: 'resume_workflow',
                scope: 'workflow',
                enabled: false,
                confirmationLevel: 'immediate',
                stale: false,
                disabledReason: 'Cancelled workflows cannot be resumed.',
              },
              {
                kind: 'cancel_workflow',
                scope: 'workflow',
                enabled: false,
                confirmationLevel: 'high_impact_confirm',
                stale: false,
                disabledReason: 'Action is not available in the current workflow state.',
              },
            ],
          }),
          stickyStrip: createStickyStrip({ posture: 'cancelled' }),
          workflowSettings: null,
          board: createBoard(),
          selectedScopeLabel: null,
          onTabChange: vi.fn(),
          onAddWork: vi.fn(),
          onOpenRedrive: vi.fn(),
          onVisibilityModeChange: vi.fn(),
        }),
      ),
    );

    expect(pausedHtml).toContain('Resume</button>');
    expect(pausedHtml).not.toContain('>Pause</button>');
    expect(cancelledHtml).not.toContain('>Resume</button>');
    expect(cancelledHtml).not.toContain('>Pause</button>');
  });

  it('keeps workflow-only controls visible in the header while a narrower scope is selected', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowStateStrip, {
          workflow: createWorkflowCard({
            availableActions: [
              {
                kind: 'pause_workflow',
                scope: 'workflow',
                enabled: true,
                confirmationLevel: 'immediate',
                stale: false,
                disabledReason: null,
              },
              {
                kind: 'cancel_workflow',
                scope: 'workflow',
                enabled: true,
                confirmationLevel: 'high_impact_confirm',
                stale: false,
                disabledReason: null,
              },
              {
                kind: 'redrive_workflow',
                scope: 'workflow',
                enabled: true,
                confirmationLevel: 'high_impact_confirm',
                stale: false,
                disabledReason: null,
              },
              {
                kind: 'add_work_item',
                scope: 'workflow',
                enabled: true,
                confirmationLevel: 'standard_confirm',
                stale: false,
                disabledReason: null,
              },
            ],
          }),
          stickyStrip: createStickyStrip(),
          workflowSettings: null,
          board: createBoard(),
          selectedScopeLabel: 'Review incoming packet',
          addWorkLabel: 'Modify Work',
          onTabChange: vi.fn(),
          onAddWork: vi.fn(),
          onOpenRedrive: vi.fn(),
          onVisibilityModeChange: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('Pause');
    expect(html).toContain('Cancel');
    expect(html).toContain('Redrive');
    expect(html).toContain('Modify Work');
    expect(html).not.toContain('Workflow-level actions only');
  });

  it('shows an explicit paused badge and only the legal lifecycle controls for paused workflows', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowStateStrip, {
          workflow: createWorkflowCard({
            state: 'paused',
            posture: 'paused',
            availableActions: [
              {
                kind: 'pause_workflow',
                scope: 'workflow',
                enabled: false,
                confirmationLevel: 'immediate',
                stale: false,
                disabledReason: 'Action is not available in the current workflow state.',
              },
              {
                kind: 'resume_workflow',
                scope: 'workflow',
                enabled: true,
                confirmationLevel: 'immediate',
                stale: false,
                disabledReason: null,
              },
              {
                kind: 'cancel_workflow',
                scope: 'workflow',
                enabled: true,
                confirmationLevel: 'high_impact_confirm',
                stale: false,
                disabledReason: null,
              },
            ],
          }),
          stickyStrip: createStickyStrip({
            posture: 'paused',
          }),
          workflowSettings: null,
          board: createBoard(),
          selectedScopeLabel: null,
          onTabChange: vi.fn(),
          onAddWork: vi.fn(),
          onOpenRedrive: vi.fn(),
          onVisibilityModeChange: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('Workflow paused');
    expect(html).toContain('Resume');
    expect(html).toContain('Cancel');
    expect(html).not.toContain('>Pause<');
  });

  it('falls back to paused workflow state for lifecycle controls when workflow actions have not loaded yet', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowStateStrip, {
          workflow: createWorkflowCard({
            state: 'paused',
            posture: 'paused',
            availableActions: [],
          }),
          stickyStrip: createStickyStrip({
            posture: 'paused',
          }),
          workflowSettings: null,
          board: createBoard(),
          selectedScopeLabel: null,
          onTabChange: vi.fn(),
          onAddWork: vi.fn(),
          onOpenRedrive: vi.fn(),
          onVisibilityModeChange: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('Workflow paused');
    expect(html).toContain('Resume');
    expect(html).toContain('Cancel');
    expect(html).not.toContain('>Pause<');
  });

  it('does not render pause or resume controls for cancelled workflows', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowStateStrip, {
          workflow: createWorkflowCard({
            state: 'cancelled',
            posture: 'cancelled',
            availableActions: [],
          }),
          stickyStrip: createStickyStrip({
            posture: 'cancelled',
          }),
          workflowSettings: null,
          board: createBoard(),
          selectedScopeLabel: null,
          onTabChange: vi.fn(),
          onAddWork: vi.fn(),
          onOpenRedrive: vi.fn(),
          onVisibilityModeChange: vi.fn(),
        }),
      ),
    );

    expect(html).not.toContain('>Pause<');
    expect(html).not.toContain('>Resume<');
    expect(html).not.toContain('>Cancel<');
  });

  it('does not render resume or cancel controls while a paused workflow is already cancelling and actions have not loaded yet', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowStateStrip, {
          workflow: createWorkflowCard({
            state: 'paused',
            posture: 'cancelling',
            availableActions: [],
          }),
          stickyStrip: createStickyStrip({
            posture: 'cancelling',
          }),
          workflowSettings: null,
          board: createBoard(),
          selectedScopeLabel: null,
          onTabChange: vi.fn(),
          onAddWork: vi.fn(),
          onOpenRedrive: vi.fn(),
          onVisibilityModeChange: vi.fn(),
        }),
      ),
    );

    expect(html).not.toContain('>Pause<');
    expect(html).not.toContain('>Resume<');
    expect(html).not.toContain('>Cancel<');
  });

  it('describes pre-dispatch activity as workflow orchestration instead of hidden board work', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowStateStrip, {
          workflow: createWorkflowCard({
            metrics: {
              ...createWorkflowCard().metrics,
              activeTaskCount: 1,
              activeWorkItemCount: 0,
            },
          }),
          stickyStrip: createStickyStrip({
            active_task_count: 1,
            active_work_item_count: 0,
          }),
          workflowSettings: null,
          board: createBoard({
            work_items: [],
          }),
          selectedScopeLabel: null,
          onTabChange: vi.fn(),
          onAddWork: vi.fn(),
          onOpenRedrive: vi.fn(),
          onVisibilityModeChange: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('Orchestrating workflow setup');
    expect(html).not.toContain('Routing new work');
  });
});

function createWorkflowCard(
  overrides: Partial<DashboardMissionControlWorkflowCard> = {},
): DashboardMissionControlWorkflowCard {
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
    ...overrides,
  };
}

function createStickyStrip(
  overrides: Partial<DashboardWorkflowStickyStrip> = {},
): DashboardWorkflowStickyStrip {
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
    ...overrides,
  };
}

function createBoard(
  overrides: Partial<DashboardWorkflowBoardResponse> = {},
): DashboardWorkflowBoardResponse {
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
    ...overrides,
  };
}
