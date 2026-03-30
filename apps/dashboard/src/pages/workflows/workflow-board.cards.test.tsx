import { describe, expect, it } from 'vitest';

import type { WorkflowTaskPreviewSummary } from './workflow-board-task-preview.js';
import { createBoard, renderWorkflowBoard } from './workflow-board.test-support.js';

describe('WorkflowBoard cards', () => {
  it('keeps the board work-item-first even when stale task-lens state is supplied', () => {
    const board = createBoard();
    const html = renderWorkflowBoard({
      board: {
        ...board,
        work_items: board.work_items.map((workItem) =>
          workItem.id === 'work-item-1'
            ? {
                ...workItem,
                gate_status: 'awaiting_approval',
              }
            : workItem,
        ),
      },
      selectedWorkItemId: 'work-item-1',
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
    });

    expect(html).toContain('>Tasks<');
    expect(html).toContain('Assess packet');
    expect(html).toContain('Write findings');
    expect(html.match(/Review incoming packet/g)?.length ?? 0).toBe(1);
    expect(html).not.toContain('Orchestrate workflow');
  });

  it('keeps task previews visible inside work-item cards without making individual tasks selectable', () => {
    const board = createBoard();
    const html = renderWorkflowBoard({
      board: {
        ...board,
        work_items: board.work_items.map((workItem) =>
          workItem.id === 'work-item-1'
            ? {
                ...workItem,
                gate_status: 'awaiting_approval',
              }
            : workItem,
        ),
      },
      selectedWorkItemId: 'work-item-1',
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
    });

    expect(html).toContain('Assess packet');
    expect(html).toContain('Tasks');
    expect(html).toContain('<details');
    expect(html).toContain('open=""');
    expect(html).not.toContain('data-task-selectable="true"');
    expect(html).toContain('data-work-item-task-area="true"');
    expect(html).toContain('data-work-item-task-row="true"');
  });

  it('shows recent task update context inside expanded work-item task summaries by default', () => {
    const html = renderWorkflowBoard({
      selectedWorkItemId: 'work-item-1',
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
    });

    expect(html).toContain('Assess packet');
    expect(html).toContain('Waiting on the final evidence packet before review can finish.');
    expect(html).toContain('data-work-item-task-area="true"');
  });

  it('shows a compact current-state summary from live task progress instead of raw goal text', () => {
    const board = createBoard();
    const html = renderWorkflowBoard({
      board: {
        ...board,
        work_items: [
          {
            ...board.work_items[0],
            goal: 'Compile the full intake record, restate the packet request, and keep the old background visible.',
          },
        ],
      },
      selectedWorkItemId: 'work-item-1',
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
    });

    expect(html).toContain(
      'Working now: Policy Assessor on Approval packet ready for reviewer handoff',
    );
    expect(html).not.toContain(
      'Compile the full intake record, restate the packet request, and keep the old background visible.',
    );
  });

  it('surfaces the active specialist directly in the work-item summary line', () => {
    const html = renderWorkflowBoard({
      selectedWorkItemId: 'work-item-1',
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
    });

    expect(html).toContain('Working now: Mixed Architecture Lead on Draft technical design');
    expect(html).toContain('Orchestrator working');
  });

  it('makes work-item cards useful by surfacing active ownership and richer task context', () => {
    const html = renderWorkflowBoard({
      selectedWorkItemId: 'work-item-1',
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
                recentUpdate: 'Reviewing integration constraints and outlining the release plan.',
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
    });

    expect(html).toContain('Active specialist');
    expect(html).toContain('Mixed Architecture Lead');
    expect(html).toContain('Draft technical design');
    expect(html).toContain('Working now');
    expect(html).toContain('Reviewing integration constraints and outlining the release plan.');
    expect(html).toContain('Requested deliverable: A concise implementation brief for the release reviewers.');
    expect(html).toContain('Success criteria: Call out blockers, dependencies, and the fallback path.');
    expect(html).toContain('Ready next');
    expect(html).toContain('Queued behind the architecture pass.');
    expect(html).toContain('data-work-item-task-area="true"');
  });

  it('styles the selected work item with accent structure instead of amber fill and surfaces local card controls', () => {
    const board = createBoard();
    const html = renderWorkflowBoard({
      board: {
        ...board,
        work_items: [
          {
            ...board.work_items[0],
            escalation_status: 'open',
            gate_status: 'awaiting_approval',
          },
        ],
      },
      selectedWorkItemId: 'work-item-1',
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
    });

    expect(html).toContain('data-work-item-card="true"');
    expect(html).toContain('data-selected="true"');
    expect(html).toContain('data-work-item-selection-edge="true"');
    expect(html).toContain('border-accent/40');
    expect(html).toContain('ring-1 ring-accent/30');
    expect(html).toContain('shadow-md');
    expect(html).toContain('text-accent');
    expect(html).toContain('data-work-item-local-control="steer"');
    expect(html).toContain('data-work-item-local-control="pause"');
    expect(html).toContain('data-work-item-local-control="cancel"');
    expect(html).toContain('data-work-item-local-control="needs-action"');
    expect(html).not.toContain('border-amber-300 bg-amber-100/90 shadow-sm');
  });

  it('renders icon-only local lifecycle controls while keeping Needs Action as the text callout', () => {
    const board = createBoard();
    const html = renderWorkflowBoard({
      board: {
        ...board,
        work_items: board.work_items.map((workItem) =>
          workItem.id === 'work-item-1'
            ? {
                ...workItem,
                gate_status: 'awaiting_approval',
              }
            : workItem,
        ),
      },
      selectedWorkItemId: 'work-item-1',
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
    });

    expect(html).toContain('aria-label="Steer work item"');
    expect(html).toContain('aria-label="Pause work item"');
    expect(html).toContain('aria-label="Cancel work item"');
    expect(html).toContain('data-work-item-local-control="needs-action"');
    expect(html).toContain('>Needs Action<');
    expect(html).not.toContain('>Steer<');
    expect(html).not.toContain('>Pause<');
    expect(html).not.toContain('>Cancel<');
  });

  it('keeps blocked context visible on the card without inflating the work-item selection button hitbox', () => {
    const html = renderWorkflowBoard({
      board: {
        columns: [
          { id: 'planned', label: 'Planned' },
          { id: 'active', label: 'Active' },
          { id: 'done', label: 'Done', is_terminal: true },
        ],
        work_items: [
          {
            id: 'work-item-blocked',
            workflow_id: 'workflow-1',
            stage_name: 'delivery',
            title: 'Prepare blocked release brief',
            priority: 'critical',
            column_id: 'active',
            blocked_state: 'blocked',
            blocked_reason: 'Waiting on rollback guidance',
            gate_decision_feedback: 'Operator should provide rollback guidance.',
            task_count: 1,
          },
        ],
        active_stages: ['delivery'],
        awaiting_gate_count: 0,
        stage_summary: [],
      },
      taskPreviewSummaries: new Map<string, WorkflowTaskPreviewSummary>([
        [
          'work-item-blocked',
          {
            tasks: [],
            hasActiveOrchestratorTask: false,
          },
        ],
      ]),
    });

    expect(html).toContain('Prepare blocked release brief');
    expect(html).toContain('Waiting on rollback guidance');
    expect(html).toContain('data-work-item-card="true"');
    expect(html).toContain('data-work-item-local-control="steer"');
    expect(html).toContain('rounded-xl border border-amber-300/60 bg-amber-50/70 p-3 text-sm text-amber-950');
    expect(html).not.toContain('data-work-item-local-control="needs-action"');
  });

  it('bounds large task stacks inside work-item cards instead of letting the card grow forever', () => {
    const html = renderWorkflowBoard({
      selectedWorkItemId: 'work-item-1',
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
    });

    expect(html).toContain('max-h-[22rem] overflow-y-auto overscroll-contain pr-1');
    expect(html).not.toContain('rounded-md border border-border/50 bg-background/30');
  });

  it('bounds dense work-item card bodies so selection stays inside the visible board viewport', () => {
    const html = renderWorkflowBoard({
      board: {
        columns: [
          { id: 'planned', label: 'Planned' },
          { id: 'doing', label: 'Doing' },
          { id: 'blocked', label: 'Blocked', is_blocked: true },
          { id: 'done', label: 'Done', is_terminal: true },
        ],
        work_items: [
          {
            id: 'work-item-blocked',
            workflow_id: 'workflow-1',
            stage_name: 'delivery',
            title: 'Prepare blocked release brief',
            priority: 'critical',
            column_id: 'blocked',
            blocked_state: 'blocked',
            blocked_reason:
              'Waiting on rollback guidance while the release packet is still pending operator direction.',
            gate_decision_feedback:
              'Rollback guidance must be provided before the item can proceed.',
            task_count: 6,
          },
        ],
        active_stages: ['delivery'],
        awaiting_gate_count: 0,
        stage_summary: [],
      },
      taskPreviewSummaries: new Map<string, WorkflowTaskPreviewSummary>([
        [
          'work-item-blocked',
          {
            tasks: Array.from({ length: 6 }, (_, index) => ({
              id: `task-${index + 1}`,
              title: `Task ${index + 1}`,
              role: 'policy-assessor',
              state: index === 0 ? 'in_progress' : 'ready',
              workItemId: 'work-item-blocked',
              workItemTitle: 'Prepare blocked release brief',
              stageName: 'delivery',
            })),
            hasActiveOrchestratorTask: false,
          },
        ],
      ]),
    });

    expect(html).toContain('data-work-item-card="true"');
    expect(html).toContain('max-h-[21rem]');
    expect(html).toContain('overflow-y-auto overscroll-contain');
    expect(html).toContain('scrollbar-width:thin');
  });
});
