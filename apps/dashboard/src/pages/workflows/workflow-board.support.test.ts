import { describe, expect, it } from 'vitest';

import type {
  DashboardWorkflowBoardColumn,
  DashboardWorkflowBoardResponse,
  DashboardWorkflowWorkItemRecord,
} from '../../lib/api.js';
import { buildWorkflowBoardView } from './workflow-board.support.js';

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

  it('renders needs-action items in the blocked lane when the stored column is stale', () => {
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

    expect(view.lanes.find((lane) => lane.column.id === 'blocked')?.activeItems.map((item) => item.id)).toEqual([
      'needs-action-item',
    ]);
    expect(view.lanes.find((lane) => lane.column.id === 'planned')?.activeItems).toEqual([]);
  });

  it('treats rejected gate work as needs-action work for blocked-lane projection', () => {
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

    expect(view.lanes.find((lane) => lane.column.id === 'blocked')?.activeItems.map((item) => item.id)).toEqual([
      'rejected-item',
    ]);
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
