import { describe, expect, it } from 'vitest';

import type {
  DashboardWorkflowBoardColumn,
  DashboardWorkflowBoardResponse,
  DashboardWorkflowWorkItemRecord,
} from '../../lib/api.js';
import {
  buildWorkflowBoardView,
  buildWorkflowBoardWorkItemSummary,
} from './workflow-board.support.js';

const BOARD_COLUMNS: DashboardWorkflowBoardColumn[] = [
  { id: 'planned', label: 'Planned' },
  { id: 'active', label: 'Active' },
  { id: 'blocked', label: 'Blocked', is_blocked: true },
  { id: 'done', label: 'Done', is_terminal: true },
];

describe('buildWorkflowBoardView', () => {
  it('builds actual board lanes in configured column order', () => {
    const board = createBoard([
      createWorkItem({ id: 'work-1', column_id: 'active', stage_name: 'drafting' }),
      createWorkItem({ id: 'work-2', column_id: 'blocked', stage_name: 'approval' }),
      createWorkItem({
        id: 'work-3',
        column_id: 'done',
        stage_name: 'delivery',
        completed_at: new Date().toISOString(),
      }),
    ]);

    const view = buildWorkflowBoardView(board, {
      boardMode: 'active_recent_complete',
      stageFilter: '__all__',
      laneFilter: '__all__',
      blockedOnly: false,
      escalatedOnly: false,
      needsActionOnly: false,
    });

    expect(view.lanes.map((lane) => lane.column.id)).toEqual(['planned', 'active', 'blocked', 'done']);
    expect(view.lanes.find((lane) => lane.column.id === 'active')?.activeItems.map((item) => item.id)).toEqual([
      'work-1',
    ]);
    expect(view.lanes.find((lane) => lane.column.id === 'blocked')?.activeItems.map((item) => item.id)).toEqual([
      'work-2',
    ]);
    expect(
      view.lanes.find((lane) => lane.column.id === 'done')?.visibleCompletedItems.map((item) => item.id),
    ).toEqual(['work-3']);
  });

  it('keeps older completed work off the board in active + recent complete mode', () => {
    const board = createBoard([
      createWorkItem({
        id: 'recent-complete',
        column_id: 'done',
        stage_name: 'delivery',
        completed_at: new Date().toISOString(),
      }),
      createWorkItem({
        id: 'older-complete',
        column_id: 'done',
        stage_name: 'delivery',
        completed_at: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
      }),
    ]);

    const view = buildWorkflowBoardView(board, {
      boardMode: 'active_recent_complete',
      stageFilter: '__all__',
      laneFilter: '__all__',
      blockedOnly: false,
      escalatedOnly: false,
      needsActionOnly: false,
    });

    const doneLane = view.lanes.find((lane) => lane.column.id === 'done');
    expect(doneLane?.visibleCompletedItems.map((item) => item.id)).toEqual(['recent-complete']);
    expect(doneLane?.hiddenCompletedCount).toBe(1);
  });

  it('supports lane, stage, and needs-action filters without changing lane structure', () => {
    const board = createBoard([
      createWorkItem({
        id: 'blocked-active',
        column_id: 'blocked',
        stage_name: 'delivery',
        blocked_state: 'blocked',
      }),
      createWorkItem({
        id: 'plain-active',
        column_id: 'active',
        stage_name: 'drafting',
      }),
    ]);

    const view = buildWorkflowBoardView(board, {
      boardMode: 'all',
      stageFilter: 'delivery',
      laneFilter: 'blocked',
      blockedOnly: true,
      escalatedOnly: false,
      needsActionOnly: true,
    });

    expect(view.filteredCount).toBe(1);
    expect(view.lanes.map((lane) => lane.column.id)).toEqual(['blocked']);
    expect(view.lanes[0]?.activeItems.map((item) => item.id)).toEqual(['blocked-active']);
  });

  it('keeps actionable work in the platform-assigned lane instead of reprojecting it in the dashboard', () => {
    const board = createBoard([
      createWorkItem({
        id: 'needs-action-item',
        column_id: 'planned',
        stage_name: 'delivery',
        gate_status: 'changes_requested',
      }),
    ]);

    const view = buildWorkflowBoardView(board, {
      boardMode: 'all',
      stageFilter: '__all__',
      laneFilter: '__all__',
      blockedOnly: false,
      escalatedOnly: false,
      needsActionOnly: false,
    });

    expect(view.lanes.find((lane) => lane.column.id === 'planned')?.activeItems.map((item) => item.id)).toEqual([
      'needs-action-item',
    ]);
    expect(view.lanes.find((lane) => lane.column.id === 'blocked')?.activeItems).toEqual([]);
  });

  it('keeps rejected work filterable as needs action without changing its lane', () => {
    const board = createBoard([
      createWorkItem({
        id: 'rejected-item',
        column_id: 'planned',
        stage_name: 'delivery',
        gate_status: 'rejected',
      }),
    ]);

    const view = buildWorkflowBoardView(board, {
      boardMode: 'all',
      stageFilter: '__all__',
      laneFilter: '__all__',
      blockedOnly: false,
      escalatedOnly: false,
      needsActionOnly: false,
    });

    expect(view.lanes.find((lane) => lane.column.id === 'planned')?.activeItems.map((item) => item.id)).toEqual([
      'rejected-item',
    ]);
  });

  it('keeps request-changes work visible in its stored lane while needs-action filters still match it', () => {
    const board = createBoard([
      createWorkItem({
        id: 'request-changes-item',
        column_id: 'planned',
        stage_name: 'delivery',
        gate_status: 'request_changes',
      }),
    ]);

    const view = buildWorkflowBoardView(board, {
      boardMode: 'all',
      stageFilter: '__all__',
      laneFilter: '__all__',
      blockedOnly: false,
      escalatedOnly: false,
      needsActionOnly: false,
    });

    expect(view.lanes.find((lane) => lane.column.id === 'planned')?.activeItems.map((item) => item.id)).toEqual([
      'request-changes-item',
    ]);
  });

  it('projects cancelled unfinished work into the terminal lane without moving paused work', () => {
    const board = createBoard([
      createWorkItem({
        id: 'cancelled-item',
        column_id: 'active',
        stage_name: 'delivery',
      }),
      createWorkItem({
        id: 'paused-item',
        column_id: 'active',
        stage_name: 'delivery',
      }),
    ]);

    const cancelledView = buildWorkflowBoardView(board, {
      boardMode: 'all',
      workflowState: 'cancelled',
      stageFilter: '__all__',
      laneFilter: '__all__',
      blockedOnly: false,
      escalatedOnly: false,
      needsActionOnly: false,
    });
    const pausedView = buildWorkflowBoardView(board, {
      boardMode: 'all',
      workflowState: 'paused',
      stageFilter: '__all__',
      laneFilter: '__all__',
      blockedOnly: false,
      escalatedOnly: false,
      needsActionOnly: false,
    });

    expect(
      cancelledView.lanes.find((lane) => lane.column.id === 'done')?.visibleCompletedItems.map((item) => item.id),
    ).toContain('cancelled-item');
    expect(cancelledView.lanes.find((lane) => lane.column.id === 'active')?.activeItems).toEqual([]);
    expect(pausedView.lanes.find((lane) => lane.column.id === 'active')?.activeItems.map((item) => item.id)).toEqual([
      'cancelled-item',
      'paused-item',
    ]);
  });

  it('prefers the top task headline over raw goal text for compact work-item summaries', () => {
    const summary = buildWorkflowBoardWorkItemSummary(
      createWorkItem({
        id: 'work-1',
        column_id: 'active',
        stage_name: 'delivery',
        goal: 'Restate the entire request payload instead of showing the latest progress.',
      }),
      {
        tasks: [
          {
            id: 'task-1',
            title: 'Reviewer packet is ready for approval',
            role: 'reviewer',
            state: 'in_progress',
          },
        ],
        hasActiveOrchestratorTask: false,
      },
    );

    expect(summary).toBe('Working now: Reviewer on Reviewer packet is ready for approval');
  });

  it('falls back to the next expected action when no task headline is available', () => {
    const summary = buildWorkflowBoardWorkItemSummary(
      createWorkItem({
        id: 'work-2',
        column_id: 'active',
        stage_name: 'delivery',
        next_expected_actor: 'reviewer',
        next_expected_action: 'approve the release packet',
      }),
      {
        tasks: [],
        hasActiveOrchestratorTask: false,
      },
    );

    expect(summary).toBe('Reviewer should approve the release packet.');
  });
});

function createBoard(workItems: DashboardWorkflowWorkItemRecord[]): DashboardWorkflowBoardResponse {
  return {
    columns: BOARD_COLUMNS,
    work_items: workItems,
    active_stages: [],
    awaiting_gate_count: 0,
    stage_summary: [],
  };
}

function createWorkItem(
  overrides: Partial<DashboardWorkflowWorkItemRecord> & Pick<DashboardWorkflowWorkItemRecord, 'id' | 'column_id' | 'stage_name'>,
): DashboardWorkflowWorkItemRecord {
  const { id, column_id, stage_name, ...rest } = overrides;
  return {
    id,
    workflow_id: 'workflow-1',
    stage_name,
    title: overrides.title ?? id,
    priority: overrides.priority ?? 'medium',
    column_id,
    blocked_state: overrides.blocked_state ?? null,
    escalation_status: overrides.escalation_status ?? null,
    gate_status: overrides.gate_status ?? null,
    completed_at: overrides.completed_at ?? null,
    task_count: overrides.task_count ?? 0,
    ...rest,
  };
}
