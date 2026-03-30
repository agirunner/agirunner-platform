import { describe, expect, it } from 'vitest';

import type { DashboardWorkflowWorkItemRecord } from '../../../lib/api.js';
import type { WorkflowTaskPreviewSummary } from '../workflow-board-task-preview.js';
import {
  buildTaskStatusSummary,
  readDesktopFitClassName,
  readWorkItemCardControls,
} from './workflow-board.support.js';

describe('workflow-board local support', () => {
  it('summarizes mixed task states into the compact board status line', () => {
    const summary: WorkflowTaskPreviewSummary = {
      tasks: [
        { id: 'task-1', role: null, state: 'in_progress', title: 'Verify deliverable' },
        { id: 'task-2', role: null, state: 'ready', title: 'Publish launch notes' },
        { id: 'task-3', role: null, state: 'failed', title: 'Rollback validation' },
        { id: 'task-4', role: null, state: 'completed', title: 'Archive evidence' },
      ],
      hasActiveOrchestratorTask: false,
    };

    expect(buildTaskStatusSummary(summary)).toBe(
      '1 working • 1 ready next • 1 blocked • 1 completed',
    );
  });

  it('keeps up to four lanes in a single desktop row before overflow mode', () => {
    expect(readDesktopFitClassName(3)).toBe('grid min-w-full gap-3 md:grid-cols-3 md:items-start');
    expect(readDesktopFitClassName(4)).toBe('grid min-w-full gap-3 md:grid-cols-4 md:items-start');
  });

  it('switches lifecycle controls between active, paused, done, and cancelled work items', () => {
    const activeControls = readWorkItemCardControls(createWorkItem(), 'active', false);
    const pausedControls = readWorkItemCardControls(
      createWorkItem({
        metadata: {
          pause_requested_at: '2026-03-30T04:00:00.000Z',
        },
      }),
      'active',
      false,
    );
    const doneControls = readWorkItemCardControls(
      createWorkItem({ completed_at: '2026-03-27T23:50:00.000Z' }),
      'active',
      true,
    );
    const cancelledControls = readWorkItemCardControls(createWorkItem(), 'cancelled', false);

    expect(activeControls.map((control) => control.action)).toEqual(['steer', 'pause', 'cancel']);
    expect(activeControls[0]?.disabled).toBe(false);
    expect(pausedControls.map((control) => control.action)).toEqual(['steer', 'resume', 'cancel']);
    expect(pausedControls[0]?.disabled).toBe(true);
    expect(doneControls.map((control) => control.action)).toEqual(['repeat']);
    expect(cancelledControls).toEqual([]);
  });
});

function createWorkItem(
  overrides: Partial<DashboardWorkflowWorkItemRecord> = {},
): DashboardWorkflowWorkItemRecord {
  return {
    id: 'work-item-1',
    workflow_id: 'workflow-1',
    stage_name: 'release',
    title: 'Prepare release bundle',
    goal: 'Assemble final artifacts for launch.',
    column_id: 'drafting',
    priority: 'normal',
    ...overrides,
  };
}
