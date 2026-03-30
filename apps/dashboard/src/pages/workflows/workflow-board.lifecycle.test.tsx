import { describe, expect, it } from 'vitest';

import type { WorkflowTaskPreviewSummary } from './workflow-board-task-preview.js';
import { createBoard, renderWorkflowBoard } from './workflow-board.test-support.js';

describe('WorkflowBoard lifecycle', () => {
  it('swaps work-item lifecycle affordances by legality, using Resume for paused work and Repeat for done work', () => {
    const pausedHtml = renderWorkflowBoard({
      selectedWorkItemId: 'work-item-1',
      workflowState: 'active',
      board: {
        ...createBoard(),
        work_items: [
          {
            id: 'work-item-1',
            workflow_id: 'workflow-1',
            stage_name: 'intake-triage',
            title: 'Review incoming packet',
            priority: 'normal',
            column_id: 'active',
            task_count: 2,
            metadata: {
              pause_requested_at: '2026-03-30T04:00:00.000Z',
            },
          },
        ],
      },
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
    const doneHtml = renderWorkflowBoard({
      board: {
        columns: [
          { id: 'planned', label: 'Planned' },
          { id: 'done', label: 'Done', is_terminal: true },
        ],
        work_items: [
          {
            id: 'work-item-2',
            workflow_id: 'workflow-1',
            stage_name: 'intake-triage',
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
      },
      selectedWorkItemId: 'work-item-2',
      boardMode: 'all',
    });

    expect(pausedHtml).toContain('data-work-item-local-control="resume"');
    expect(pausedHtml).not.toContain('data-work-item-local-control="pause"');
    expect(doneHtml).toContain('data-work-item-local-control="repeat"');
    expect(doneHtml).not.toContain('data-work-item-local-control="pause"');
    expect(doneHtml).not.toContain('data-work-item-local-control="resume"');
    expect(doneHtml).not.toContain('data-work-item-local-control="cancel"');
  });

  it('keeps paused work in its lane and marks it as paused', () => {
    const html = renderWorkflowBoard({
      board: {
        ...createBoard(),
        work_items: [
          {
            id: 'work-item-1',
            workflow_id: 'workflow-1',
            stage_name: 'intake-triage',
            title: 'Review incoming packet',
            priority: 'normal',
            column_id: 'active',
            task_count: 2,
            metadata: {
              pause_requested_at: '2026-03-30T04:00:00.000Z',
            },
          },
        ],
      },
      workflowState: 'active',
    });

    expect(html).toContain('Review incoming packet');
    expect(html).toContain('>Paused<');
    expect(html.indexOf('>Active</p>')).toBeLessThan(html.indexOf('Review incoming packet'));
    expect(html.indexOf('Review incoming packet')).toBeLessThan(html.indexOf('>Done</p>'));
  });

  it('shows cancelled work in Done with a cancelled badge instead of leaving it in an active lane', () => {
    const html = renderWorkflowBoard({
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
            metadata: {
              cancel_requested_at: '2026-03-30T04:05:00.000Z',
            },
            completed_at: '2026-03-30T04:05:00.000Z',
          },
        ],
      },
      workflowState: 'active',
    });

    expect(html).toContain('Cancelled packet review');
    expect(html).toContain('>Cancelled<');
    expect(html.indexOf('>Done</p>')).toBeLessThan(html.indexOf('Cancelled packet review'));
    expect(html).not.toContain('No completed work items match the current visibility window.');
  });

  it('does not label completed workflow work as cancelled when it is only projected into the terminal lane', () => {
    const html = renderWorkflowBoard({
      board: {
        ...createBoard(),
        work_items: [
          {
            id: 'work-item-completed',
            workflow_id: 'workflow-1',
            stage_name: 'delivery',
            title: 'Publish terminal brief',
            priority: 'high',
            column_id: 'planned',
          },
        ],
      },
      workflowState: 'completed',
    });

    expect(html).toContain('Publish terminal brief');
    expect(html.indexOf('>Done</p>')).toBeLessThan(html.indexOf('Publish terminal brief'));
    expect(html).not.toContain('>Cancelled<');
  });
});
