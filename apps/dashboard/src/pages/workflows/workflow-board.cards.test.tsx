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

    expect(html).toContain('Assess packet');
    expect(html).toContain('Write findings');
    expect(countWorkItemTaskRows(html)).toBe(2);
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
    expect(html).not.toContain('data-task-selectable="true"');
    expect(countWorkItemTaskAreas(html)).toBe(1);
    expect(countWorkItemTaskRows(html)).toBe(1);
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

    expect(html).toContain('Policy Assessor');
    expect(html).toContain('Approval packet ready for reviewer handoff');
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

    expect(html).toContain('Mixed Architecture Lead');
    expect(html).toContain('Draft technical design');
  });

  it('shows the orchestrator task when it becomes the only active task on the card', () => {
    const html = renderWorkflowBoard({
      selectedWorkItemId: 'work-item-1',
      taskPreviewSummaries: new Map<string, WorkflowTaskPreviewSummary>([
        [
          'work-item-1',
          {
            tasks: [
              {
                id: 'task-specialist',
                title: 'Review evidence for what is a quantum computer?',
                role: 'research-analyst',
                state: 'completed',
                isOrchestratorTask: false,
                workItemId: 'work-item-1',
                workItemTitle: 'Review sources',
                stageName: 'source-review',
              },
              {
                id: 'task-orchestrator',
                title: 'Orchestrate Research Analysis: What is a quantum computer?',
                role: 'orchestrator',
                state: 'in_progress',
                isOrchestratorTask: true,
                workItemId: 'work-item-1',
                workItemTitle: 'Review sources',
                stageName: 'source-review',
              },
            ],
            hasActiveOrchestratorTask: true,
          },
        ],
      ]),
    });

    expect(html).toContain('Orchestrate Research Analysis: What is a quantum computer?');
    expect(countWorkItemTaskRows(html)).toBe(2);
  });

  it('keeps live active tasks visible on completed work-item cards during routing', () => {
    const board = createBoard();
    const html = renderWorkflowBoard({
      board: {
        ...board,
        work_items: board.work_items.map((workItem) => ({
          ...workItem,
          column_id: 'done',
          completed_at: '2026-04-04T22:27:54.956Z',
        })),
      },
      selectedWorkItemId: 'work-item-1',
      taskPreviewSummaries: new Map<string, WorkflowTaskPreviewSummary>([
        [
          'work-item-1',
          {
            tasks: [
              {
                id: 'task-specialist',
                title: 'Compare sources for quantum computer analysis',
                role: 'research-analyst',
                state: 'completed',
                isOrchestratorTask: false,
                workItemId: 'work-item-1',
                workItemTitle: 'Review sources',
                stageName: 'source-review',
              },
              {
                id: 'task-orchestrator',
                title: 'Orchestrate Research Analysis: What is a quantum computer?',
                role: 'orchestrator',
                state: 'in_progress',
                isOrchestratorTask: true,
                workItemId: 'work-item-1',
                workItemTitle: 'Review sources',
                stageName: 'source-review',
              },
            ],
            hasActiveOrchestratorTask: true,
          },
        ],
      ]),
    });

    expect(html).toContain('Orchestrate Research Analysis: What is a quantum computer?');
    expect(html).toContain('Compare sources for quantum computer analysis');
    expect(countWorkItemTaskRows(html)).toBe(2);
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

    expect(html).toContain('Mixed Architecture Lead');
    expect(html).toContain('Draft technical design');
    expect(html).toContain('Reviewing integration constraints and outlining the release plan.');
    expect(html).toContain('Requested deliverable: A concise implementation brief for the release reviewers.');
    expect(html).toContain('Success criteria: Call out blockers, dependencies, and the fallback path.');
    expect(html).toContain('Queued behind the architecture pass.');
    expect(countWorkItemTaskAreas(html)).toBe(1);
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
    expect(html).not.toContain('data-work-item-local-control="needs-action"');
  });
});

function countWorkItemTaskAreas(html: string): number {
  return html.match(/data-work-item-task-area="true"/g)?.length ?? 0;
}

function countWorkItemTaskRows(html: string): number {
  return html.match(/data-work-item-task-row="true"/g)?.length ?? 0;
}
