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
          selectedTaskId: null,
          boardLens: 'work_items',
          boardMode: 'active_recent_complete',
          onBoardLensChange: vi.fn(),
          onBoardModeChange: vi.fn(),
          onSelectWorkItem: vi.fn(),
          onSelectTask: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('Workflow board');
    expect(html).toContain('All stages');
    expect(html).toContain('All lanes');
    expect(html).toContain('flex min-w-0 flex-wrap items-center gap-2 pb-1');
    expect(html).toContain('min-h-0 flex-1 overflow-auto pb-1');
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
          selectedTaskId: null,
          boardLens: 'work_items',
          boardMode: 'active_recent_complete',
          onBoardLensChange: vi.fn(),
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
    expect(html).not.toContain('1 active • 0 completed');
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
          boardLens: 'work_items',
          boardMode: 'active_recent_complete',
          onBoardLensChange: vi.fn(),
          onBoardModeChange: vi.fn(),
          onSelectWorkItem: vi.fn(),
          onSelectTask: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('Recent completions');
    expect(html).not.toContain(
      '<details class="rounded-2xl border border-border/70 bg-background/70 p-3" open="">',
    );
    expect(html).not.toContain('>3 tasks<');
    expect(html).not.toContain('flex min-h-[8rem] items-center justify-center text-center');
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
          selectedTaskId: null,
          boardLens: 'work_items',
          boardMode: 'active_recent_complete',
          onBoardLensChange: vi.fn(),
          onBoardModeChange: vi.fn(),
          onSelectWorkItem: vi.fn(),
          onSelectTask: vi.fn(),
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
          selectedTaskId: null,
          boardLens: 'work_items',
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
          onBoardLensChange: vi.fn(),
          onBoardModeChange: vi.fn(),
          onSelectWorkItem: vi.fn(),
          onSelectTask: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('Review incoming packet');
    expect(html).not.toContain('No task previews available yet.');
    expect(html).not.toContain('Task preview');
    expect(html.match(/>Tasks</g)?.length ?? 0).toBe(1);
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
          selectedTaskId: null,
          boardLens: 'work_items',
          boardMode: 'active_recent_complete',
          onBoardLensChange: vi.fn(),
          onBoardModeChange: vi.fn(),
          onSelectWorkItem: vi.fn(),
          onSelectTask: vi.fn(),
        }),
      ),
    );

    expect(html).toContain(
      'grid gap-3 md:grid-flow-col md:auto-cols-[minmax(17.5rem,1fr)] md:items-start',
    );
    expect(html).toContain(
      'grid min-w-0 content-start gap-2.5 rounded-lg border border-border/60 bg-muted/5 p-2.5',
    );
    expect(html).not.toContain(
      'grid min-h-full gap-3 md:grid-flow-col md:auto-cols-[minmax(17.5rem,1fr)]',
    );
    expect(html).not.toContain(
      'grid h-full min-w-0 content-start gap-2.5 rounded-lg border border-border/60 bg-muted/5 p-2.5',
    );
  });

  it('supports a task lens that renders only specialist tasks as first-class cards', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowBoard, {
          workflowId: 'workflow-1',
          board: createBoard(),
          selectedWorkItemId: 'work-item-1',
          selectedTaskId: 'task-specialist',
          boardLens: 'tasks',
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
          onBoardLensChange: vi.fn(),
          onBoardModeChange: vi.fn(),
          onSelectWorkItem: vi.fn(),
          onSelectTask: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('Tasks');
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
          selectedTaskId: 'task-specialist',
          boardLens: 'work_items',
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
          onBoardLensChange: vi.fn(),
          onBoardModeChange: vi.fn(),
          onSelectWorkItem: vi.fn(),
          onSelectTask: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('Assess packet');
    expect(html).toContain('Tasks');
    expect(html).not.toContain('<details');
    expect(html).not.toContain('data-task-selectable="true"');
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
          selectedTaskId: null,
          boardLens: 'work_items',
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
          onBoardLensChange: vi.fn(),
          onBoardModeChange: vi.fn(),
          onSelectWorkItem: vi.fn(),
          onSelectTask: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('Assess packet');
    expect(html).toContain('Waiting on the final evidence packet before review can finish.');
    expect(html).not.toContain('data-task-selectable="true"');
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
          selectedTaskId: null,
          boardLens: 'work_items',
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
          onBoardLensChange: vi.fn(),
          onBoardModeChange: vi.fn(),
          onSelectWorkItem: vi.fn(),
          onSelectTask: vi.fn(),
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
          selectedTaskId: null,
          boardLens: 'work_items',
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
          onBoardLensChange: vi.fn(),
          onBoardModeChange: vi.fn(),
          onSelectWorkItem: vi.fn(),
          onSelectTask: vi.fn(),
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
          selectedTaskId: null,
          boardLens: 'work_items',
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
          onBoardLensChange: vi.fn(),
          onBoardModeChange: vi.fn(),
          onSelectWorkItem: vi.fn(),
          onSelectTask: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('Active specialist');
    expect(html).toContain('Mixed Architecture Lead');
    expect(html).toContain('Draft technical design');
    expect(html).toContain('Working now');
    expect(html).toContain('Reviewing integration constraints and outlining the release plan.');
    expect(html).toContain('Ready next');
    expect(html).toContain('Queued behind the architecture pass.');
    expect(html).not.toContain('>2 tasks<');
    expect(html).not.toContain('data-task-selectable="true"');
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
          selectedTaskId: null,
          boardLens: 'work_items',
          boardMode: 'active_recent_complete',
          workflowState: 'paused',
          onBoardLensChange: vi.fn(),
          onBoardModeChange: vi.fn(),
          onSelectWorkItem: vi.fn(),
          onSelectTask: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('Review incoming packet');
    expect(html).toContain('Workflow paused');
    expect(html).toContain('>Paused<');
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
