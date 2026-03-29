import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import type { DashboardWorkflowBoardResponse } from '../../lib/api.js';
import { WorkflowBoard } from './workflow-board.js';
import type { WorkflowTaskPreviewSummary } from './workflow-board-task-preview.js';

describe('WorkflowBoard', () => {
  it('wraps board controls on smaller screens instead of hiding them behind horizontal overflow', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowBoard, {
          workflowId: 'workflow-1',
          board: createBoard(),
          selectedWorkItemId: null,
          boardMode: 'active_recent_complete',
          onBoardModeChange: vi.fn(),
          onSelectWorkItem: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('Workflow board');
    expect(html).toContain('All stages');
    expect(html).toContain('All lanes');
    expect(html).toContain('flex min-w-0 flex-wrap items-center gap-2 pb-1');
    expect(html).toContain('min-h-0 flex-1 overflow-x-auto overflow-y-auto pb-1');
    expect(html).toContain('flex h-full min-h-[13rem] min-w-0 flex-col gap-3 overflow-hidden px-3 py-3 sm:min-h-[15rem] lg:min-h-0');
    expect(html).not.toContain('rounded-2xl border border-border/70 bg-background/90 p-2.5 shadow-sm');
    expect(html).not.toContain('rounded-2xl bg-background/90 p-2.5');
    expect(html).not.toContain('flex flex-wrap items-center justify-between gap-3');
    expect(html).not.toContain('Lanes show the actual workflow flow while tasks stay subordinate');
    expect(html).not.toContain('Active stage:');
    expect(html).not.toContain('visible items');
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
          boardMode: 'active_recent_complete',
          onBoardModeChange: vi.fn(),
          onSelectWorkItem: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('Intake Triage');
    expect(html).not.toContain('normal');
    expect(html).not.toContain('>Medium<');
    expect(html).not.toContain('visible items');
    expect(html).not.toContain('>1 visible<');
    expect(html).not.toContain('1 active • 0 completed');
  });

  it('keeps the two most recent completions visible while collapsing older overflow by default', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowBoard, {
          workflowId: 'workflow-1',
          board: createBoardWithRecentCompletion(),
          selectedWorkItemId: null,
          boardMode: 'active_recent_complete',
          onBoardModeChange: vi.fn(),
          onSelectWorkItem: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('Recent completions');
    expect(html).toContain('Completed packet 1');
    expect(html).toContain('Completed packet 2');
    expect(html.indexOf('Completed packet 1')).toBeLessThan(html.indexOf('Recent completions'));
    expect(html.indexOf('Completed packet 2')).toBeLessThan(html.indexOf('Recent completions'));
    expect(html.indexOf('Completed packet 3')).toBeGreaterThan(html.indexOf('Recent completions'));
    expect(html.indexOf('Completed packet 4')).toBeGreaterThan(html.indexOf('Recent completions'));
    expect(html).toContain('2 older hidden');
    expect(html).not.toContain(
      '<details class="rounded-lg border border-border/70 bg-background/70 p-3" open="">',
    );
    expect(html).not.toContain('>3 tasks<');
    expect(html).not.toContain('flex min-h-[8rem] items-center justify-center text-center');
  });

  it('keeps the two newest done items pinned while older done items move into the recent completions bucket in all mode', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowBoard, {
          workflowId: 'workflow-1',
          board: createBoardWithRecentCompletion(),
          selectedWorkItemId: null,
          boardMode: 'all',
          onBoardModeChange: vi.fn(),
          onSelectWorkItem: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('Recent completions');
    expect(html.indexOf('Completed packet 1')).toBeLessThan(html.indexOf('Recent completions'));
    expect(html.indexOf('Completed packet 2')).toBeLessThan(html.indexOf('Recent completions'));
    expect(html.indexOf('Completed packet 3')).toBeGreaterThan(html.indexOf('Recent completions'));
    expect(html.indexOf('Completed packet 4')).toBeGreaterThan(html.indexOf('Recent completions'));
    expect(html).toContain('2 older hidden');
    expect(html).not.toContain(
      '<details class="rounded-lg border border-border/70 bg-background/70 p-3" open="">',
    );
  });

  it('renders empty-lane copy inline instead of as a centered pseudo-card', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowBoard, {
          workflowId: 'workflow-1',
          board: createBoard(),
          selectedWorkItemId: null,
          boardMode: 'active_recent_complete',
          onBoardModeChange: vi.fn(),
          onSelectWorkItem: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('Nothing active here right now.');
    expect(html).toContain('px-1 pb-1 text-sm text-muted-foreground');
    expect(html).not.toContain('No active work items in this lane.');
    expect(html).not.toContain('grid min-h-[10rem] place-items-center text-center');
  });

  it('omits the empty task shell when a work item has no task previews yet', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowBoard, {
          workflowId: 'workflow-1',
          board: createBoard(),
          selectedWorkItemId: 'work-item-1',
          boardMode: 'active_recent_complete',
          taskPreviewSummaries: new Map<string, WorkflowTaskPreviewSummary>([
            [
              'work-item-1',
              {
                tasks: [],
                hasActiveOrchestratorTask: false,
              },
            ],
          ]),
          onBoardModeChange: vi.fn(),
          onSelectWorkItem: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('Review incoming packet');
    expect(html).not.toContain('No task previews available yet.');
    expect(html).not.toContain('Task preview');
    expect(html).not.toContain('>Tasks<');
  });

  it('keeps sparse lanes content-sized instead of stretching them to the full board height', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowBoard, {
          workflowId: 'workflow-1',
          board: createBoard(),
          selectedWorkItemId: null,
          boardMode: 'active_recent_complete',
          onBoardModeChange: vi.fn(),
          onSelectWorkItem: vi.fn(),
        }),
      ),
    );

    expect(html).toContain(
      'grid w-max min-w-full gap-3 md:grid-flow-col md:auto-cols-[minmax(18rem,1fr)] md:items-start',
    );
    expect(html).toContain(
      'grid min-w-0 content-start gap-2.5 rounded-lg border border-border/60 bg-muted/5 p-2.5',
    );
    expect(html).not.toContain(
      'flex h-full min-h-[18rem] min-w-0 flex-col gap-2 overflow-hidden rounded-2xl border border-border/70 bg-background/90 p-2.5 shadow-sm lg:min-h-0',
    );
    expect(html).not.toContain(
      'grid min-h-full gap-3 md:grid-flow-col md:auto-cols-[minmax(17.5rem,1fr)]',
    );
    expect(html).not.toContain(
      'grid h-full min-w-0 content-start gap-2.5 rounded-lg border border-border/60 bg-muted/5 p-2.5',
    );
  });

  it('uses a shorter mobile board minimum so the lower workbench stays reachable on phone', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowBoard, {
          workflowId: 'workflow-1',
          board: createBoard(),
          selectedWorkItemId: null,
          boardMode: 'active_recent_complete',
          onBoardModeChange: vi.fn(),
          onSelectWorkItem: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('min-h-[13rem]');
    expect(html).toContain('sm:min-h-[15rem]');
    expect(html).not.toContain('sm:min-h-[18rem]');
  });

  it('keeps the terminal lane inside a horizontally scrollable board track so done items stay reachable on desktop', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowBoard, {
          workflowId: 'workflow-1',
          board: createWideBoard(),
          selectedWorkItemId: null,
          boardMode: 'active_recent_complete',
          onBoardModeChange: vi.fn(),
          onSelectWorkItem: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('overflow-x-auto overflow-y-auto');
    expect(html).toContain('grid w-max min-w-full gap-3 md:grid-flow-col md:auto-cols-[minmax(18rem,1fr)] md:items-start');
    expect(html).toContain('Terminal lane');
    expect(html).toContain('Completed packet 1');
  });

  it('keeps the board work-item-first even when stale task-lens state is supplied', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowBoard, {
          workflowId: 'workflow-1',
          board: createBoard(),
          selectedWorkItemId: 'work-item-1',
          boardMode: 'active_recent_complete',
          taskPreviewSummaries: new Map<string, WorkflowTaskPreviewSummary>([
            [
              'work-item-1',
              {
                tasks: [
                  {
                    id: 'task-specialist',
                    title: 'Assess packet',
                    role: 'policy-assessor',
                    state: 'in_progress',
                    workItemId: 'work-item-1',
                    workItemTitle: 'Review incoming packet',
                    stageName: 'intake-triage',
                  },
                  {
                    id: 'task-follow-up',
                    title: 'Write findings',
                    role: 'policy-assessor',
                    state: 'pending',
                    workItemId: 'work-item-1',
                    workItemTitle: 'Review incoming packet',
                    stageName: 'intake-triage',
                  },
                ],
                hasActiveOrchestratorTask: true,
              },
            ],
          ]),
          onBoardModeChange: vi.fn(),
          onSelectWorkItem: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('>Tasks<');
    expect(html).not.toContain('>Work items<');
    expect(html).toContain('Assess packet');
    expect(html).toContain('Write findings');
    expect(html.match(/Review incoming packet/g)?.length ?? 0).toBe(1);
    expect(html).not.toContain('Task stack');
    expect(html).not.toContain('Orchestrate workflow');
  });

  it('keeps task previews visible inside work-item cards without making individual tasks selectable', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowBoard, {
          workflowId: 'workflow-1',
          board: createBoard(),
          selectedWorkItemId: 'work-item-1',
          boardMode: 'active_recent_complete',
          taskPreviewSummaries: new Map<string, WorkflowTaskPreviewSummary>([
            [
              'work-item-1',
              {
                tasks: [
                  {
                    id: 'task-specialist',
                    title: 'Assess packet',
                    role: 'policy-assessor',
                    state: 'in_progress',
                    workItemId: 'work-item-1',
                    workItemTitle: 'Review incoming packet',
                    stageName: 'intake-triage',
                  },
                ],
                hasActiveOrchestratorTask: false,
              },
            ],
          ]),
          onBoardModeChange: vi.fn(),
          onSelectWorkItem: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('Assess packet');
    expect(html).toContain('Tasks');
    expect(html).not.toContain('<details');
    expect(html).not.toContain('data-task-selectable="true"');
    expect(html).toContain('data-work-item-task-area="true"');
    expect(html).toContain('data-work-item-task-row="true"');
  });

  it('shows recent task update context inside expanded work-item task summaries by default', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowBoard, {
          workflowId: 'workflow-1',
          board: createBoard(),
          selectedWorkItemId: 'work-item-1',
          boardMode: 'active_recent_complete',
          taskPreviewSummaries: new Map<string, WorkflowTaskPreviewSummary>([
            [
              'work-item-1',
              {
                tasks: [
                  {
                    id: 'task-specialist',
                    title: 'Assess packet',
                    role: 'policy-assessor',
                    state: 'in_progress',
                    recentUpdate: 'Waiting on the final evidence packet before review can finish.',
                    workItemId: 'work-item-1',
                    workItemTitle: 'Review incoming packet',
                    stageName: 'intake-triage',
                  },
                ],
                hasActiveOrchestratorTask: false,
              },
            ],
          ]),
          onBoardModeChange: vi.fn(),
          onSelectWorkItem: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('Assess packet');
    expect(html).toContain('Waiting on the final evidence packet before review can finish.');
    expect(html).not.toContain('data-task-selectable="true"');
    expect(html).toContain('data-work-item-task-area="true"');
  });

  it('shows a compact current-state summary from live task progress instead of raw goal text', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowBoard, {
          workflowId: 'workflow-1',
          board: {
            ...createBoard(),
            work_items: [
              {
                ...createBoard().work_items[0],
                goal: 'Compile the full intake record, restate the packet request, and keep the old background visible.',
              },
            ],
          },
          selectedWorkItemId: 'work-item-1',
          boardMode: 'active_recent_complete',
          taskPreviewSummaries: new Map<string, WorkflowTaskPreviewSummary>([
            [
              'work-item-1',
              {
                tasks: [
                  {
                    id: 'task-specialist',
                    title: 'Approval packet ready for reviewer handoff',
                    role: 'policy-assessor',
                    state: 'in_progress',
                    workItemId: 'work-item-1',
                    workItemTitle: 'Review incoming packet',
                    stageName: 'intake-triage',
                  },
                ],
                hasActiveOrchestratorTask: false,
              },
            ],
          ]),
          onBoardModeChange: vi.fn(),
          onSelectWorkItem: vi.fn(),
        }),
      ),
    );

    expect(html).toContain(
      'Working now: Policy Assessor on Approval packet ready for reviewer handoff',
    );
    expect(html).not.toContain(
      'Compile the full intake record, restate the packet request, and keep the old background visible.',
    );
    expect(html).not.toContain('>2 tasks<');
  });

  it('surfaces the active specialist directly in the work-item summary line', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowBoard, {
          workflowId: 'workflow-1',
          board: createBoard(),
          selectedWorkItemId: 'work-item-1',
          boardMode: 'active_recent_complete',
          taskPreviewSummaries: new Map<string, WorkflowTaskPreviewSummary>([
            [
              'work-item-1',
              {
                tasks: [
                  {
                    id: 'task-architect',
                    title: 'Draft technical design',
                    role: 'mixed-architecture-lead',
                    state: 'in_progress',
                    workItemId: 'work-item-1',
                    workItemTitle: 'Review incoming packet',
                    stageName: 'intake-triage',
                  },
                ],
                hasActiveOrchestratorTask: true,
              },
            ],
          ]),
          onBoardModeChange: vi.fn(),
          onSelectWorkItem: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('Working now: Mixed Architecture Lead on Draft technical design');
    expect(html).toContain('Orchestrator working');
  });

  it('makes work-item cards useful by surfacing active ownership and richer task context', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowBoard, {
          workflowId: 'workflow-1',
          board: createBoard(),
          selectedWorkItemId: 'work-item-1',
          boardMode: 'active_recent_complete',
          taskPreviewSummaries: new Map<string, WorkflowTaskPreviewSummary>([
            [
              'work-item-1',
              {
                tasks: [
                  {
                    id: 'task-architect',
                    title: 'Draft technical design',
                    role: 'mixed-architecture-lead',
                    state: 'in_progress',
                    recentUpdate:
                      'Reviewing integration constraints and outlining the release plan.',
                    operatorSummary: [
                      'Requested deliverable: A concise implementation brief for the release reviewers.',
                      'Success criteria: Call out blockers, dependencies, and the fallback path.',
                    ],
                    workItemId: 'work-item-1',
                    workItemTitle: 'Review incoming packet',
                    stageName: 'intake-triage',
                  },
                  {
                    id: 'task-review',
                    title: 'Review implementation notes',
                    role: 'mixed-reviewer',
                    state: 'ready',
                    recentUpdate: 'Queued behind the architecture pass.',
                    workItemId: 'work-item-1',
                    workItemTitle: 'Review incoming packet',
                    stageName: 'intake-triage',
                  },
                ],
                hasActiveOrchestratorTask: false,
              },
            ],
          ]),
          onBoardModeChange: vi.fn(),
          onSelectWorkItem: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('Active specialist');
    expect(html).toContain('Mixed Architecture Lead');
    expect(html).toContain('Draft technical design');
    expect(html).toContain('Working now');
    expect(html).toContain('Reviewing integration constraints and outlining the release plan.');
    expect(html).toContain(
      'Requested deliverable: A concise implementation brief for the release reviewers.',
    );
    expect(html).toContain(
      'Success criteria: Call out blockers, dependencies, and the fallback path.',
    );
    expect(html).toContain('Ready next');
    expect(html).toContain('Queued behind the architecture pass.');
    expect(html).not.toContain('>2 tasks<');
    expect(html).not.toContain('data-task-selectable="true"');
    expect(html).toContain('data-work-item-task-area="true"');
  });

  it('bounds large task stacks inside work-item cards instead of letting the card grow forever', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowBoard, {
          workflowId: 'workflow-1',
          board: createBoard(),
          selectedWorkItemId: 'work-item-1',
          boardMode: 'active_recent_complete',
          taskPreviewSummaries: new Map<string, WorkflowTaskPreviewSummary>([
            [
              'work-item-1',
              {
                tasks: Array.from({ length: 6 }, (_, index) => ({
                  id: `task-${index + 1}`,
                  title: `Task ${index + 1}`,
                  role: 'policy-assessor',
                  state: index === 0 ? 'in_progress' : 'ready',
                  workItemId: 'work-item-1',
                  workItemTitle: 'Review incoming packet',
                  stageName: 'intake-triage',
                })),
                hasActiveOrchestratorTask: false,
              },
            ],
          ]),
          onBoardModeChange: vi.fn(),
          onSelectWorkItem: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('max-h-[16rem] overflow-y-auto overscroll-contain pr-1');
    expect(html).toContain('rounded-md border border-border/50 bg-background/30');
  });

  it('keeps paused work in its lane and marks it as paused', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowBoard, {
          workflowId: 'workflow-1',
          board: createBoard(),
          selectedWorkItemId: null,
          boardMode: 'active_recent_complete',
          workflowState: 'paused',
          onBoardModeChange: vi.fn(),
          onSelectWorkItem: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('Review incoming packet');
    expect(html).toContain('Workflow paused');
    expect(html).toContain('>Paused<');
    expect(html.indexOf('>Active</p>')).toBeLessThan(html.indexOf('Review incoming packet'));
    expect(html.indexOf('Review incoming packet')).toBeLessThan(html.indexOf('>Done</p>'));
  });

  it('shows cancelled work in Done with a cancelled badge instead of leaving it in an active lane', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowBoard, {
          workflowId: 'workflow-1',
          board: {
            ...createBoard(),
            work_items: [
              {
                id: 'work-item-cancelled',
                workflow_id: 'workflow-1',
                stage_name: 'intake-triage',
                title: 'Cancelled packet review',
                priority: 'normal',
                column_id: 'active',
              },
            ],
          },
          selectedWorkItemId: null,
          boardMode: 'active_recent_complete',
          workflowState: 'cancelled',
          onBoardModeChange: vi.fn(),
          onSelectWorkItem: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('Cancelled packet review');
    expect(html).toContain('>Cancelled<');
    expect(html.indexOf('>Done</p>')).toBeLessThan(html.indexOf('Cancelled packet review'));
    expect(html).not.toContain('No completed work items match the current visibility window.');
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

function createWideBoard(): DashboardWorkflowBoardResponse {
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
