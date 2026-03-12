import { describe, expect, it } from 'vitest';

import {
  countBlockedBoardItems,
  countOpenBoardItems,
  describeBoardHeadline,
  describeWorkflowStage,
  isLiveWorkflow,
  resolveBoardPosture,
} from './live-board-support.js';

describe('live board support', () => {
  const board = {
    columns: [
      { id: 'planned', label: 'Planned' },
      { id: 'active', label: 'Active' },
      { id: 'blocked', label: 'Blocked', is_blocked: true },
      { id: 'done', label: 'Done', is_terminal: true },
    ],
    work_items: [
      { id: 'wi-1', workflow_id: 'wf-1', stage_name: 'build', title: 'Ship build', column_id: 'active', priority: 'high' },
      { id: 'wi-2', workflow_id: 'wf-1', stage_name: 'review', title: 'Unblock QA', column_id: 'blocked', priority: 'normal' },
      { id: 'wi-3', workflow_id: 'wf-1', stage_name: 'release', title: 'Release', column_id: 'done', priority: 'normal' },
    ],
    stage_summary: [],
  };

  it('counts open and blocked work items from board columns', () => {
    expect(countOpenBoardItems(board as never)).toBe(2);
    expect(countBlockedBoardItems(board as never)).toBe(1);
  });

  it('describes the current stage footprint', () => {
    expect(describeWorkflowStage({ current_stage: 'implementation' })).toBe('implementation');
    expect(describeWorkflowStage({ active_stages: ['implementation', 'review'] })).toBe('implementation, review');
    expect(
      describeWorkflowStage({
        lifecycle: 'continuous',
        current_stage: 'legacy-stage',
        active_stages: ['implementation'],
        work_item_summary: {
          total_work_items: 3,
          open_work_item_count: 2,
          awaiting_gate_count: 0,
          active_stage_names: ['implementation', 'review'],
        },
      }),
    ).toBe('implementation, review');
    expect(
      describeWorkflowStage({
        lifecycle: 'continuous',
        current_stage: 'legacy-stage',
      }),
    ).toBe('--');
    expect(describeWorkflowStage({})).toBe('--');
  });

  it('prefers blocked and gate posture before generic active state', () => {
    expect(resolveBoardPosture({ state: 'running', work_item_summary: { total_work_items: 3, open_work_item_count: 2, awaiting_gate_count: 0 } }, board as never)).toBe('blocked');
    expect(resolveBoardPosture({ state: 'running', work_item_summary: { total_work_items: 3, open_work_item_count: 1, awaiting_gate_count: 1 } })).toBe('awaiting gate');
    expect(resolveBoardPosture({ state: 'running', work_item_summary: { total_work_items: 3, open_work_item_count: 1, awaiting_gate_count: 0 } })).toBe('active');
    expect(resolveBoardPosture({ state: 'completed', work_item_summary: { total_work_items: 3, open_work_item_count: 0, awaiting_gate_count: 0 } })).toBe('done');
  });

  it('keeps workflow.state as a fallback when richer board posture is absent', () => {
    expect(
      describeBoardHeadline(
        {
          state: 'failed',
          work_item_summary: {
            total_work_items: 0,
            open_work_item_count: 0,
            awaiting_gate_count: 0,
          },
        },
      ),
    ).toBe('Board execution failed');
    expect(isLiveWorkflow({ state: 'failed' })).toBe(true);
    expect(isLiveWorkflow({ state: 'completed' })).toBe(false);
  });

  it('prioritizes open work and gate posture over raw workflow state', () => {
    const workflow = {
      state: 'failed',
      work_item_summary: {
        total_work_items: 4,
        open_work_item_count: 2,
        awaiting_gate_count: 1,
      },
    };

    expect(resolveBoardPosture(workflow)).toBe('awaiting gate');
    expect(describeBoardHeadline(workflow)).toBe('1 gate review waiting');
    expect(isLiveWorkflow(workflow)).toBe(true);
  });
});
