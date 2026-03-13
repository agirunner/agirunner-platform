import { describe, expect, it } from 'vitest';

import {
  buildWorkflowStageProgressSteps,
  describeWorkflowStageLabel,
  describeWorkflowStageProgressSummary,
  describeWorkflowStageSummary,
} from './live-board-stage-presentation.js';

describe('live board stage presentation', () => {
  it('uses lifecycle-aware stage labels', () => {
    expect(describeWorkflowStageLabel({})).toBe('Current stage');
    expect(
      describeWorkflowStageLabel({
        lifecycle: 'continuous',
      }),
    ).toBe('Live stages');
  });

  it('renders a labeled stage summary for the board table', () => {
    expect(
      describeWorkflowStageSummary({
        current_stage: 'review',
      }),
    ).toBe('Current stage · review');

    expect(
      describeWorkflowStageSummary({
        lifecycle: 'continuous',
        active_stages: ['implementation', 'verification'],
      }),
    ).toBe('Live stages · implementation, verification');
  });

  it('builds stage progress packets from board stage summaries', () => {
    const board = {
      columns: [],
      work_items: [],
      active_stages: ['implementation'],
      awaiting_gate_count: 1,
      stage_summary: [
        {
          name: 'requirements',
          goal: 'Capture requirements',
          status: 'completed',
          is_active: false,
          gate_status: 'approved',
          work_item_count: 2,
          open_work_item_count: 0,
          completed_count: 2,
        },
        {
          name: 'implementation',
          goal: 'Build feature',
          status: 'in_progress',
          is_active: true,
          gate_status: 'not_required',
          work_item_count: 3,
          open_work_item_count: 2,
          completed_count: 1,
        },
        {
          name: 'verification',
          goal: 'Review output',
          status: 'ready',
          is_active: false,
          gate_status: 'requested',
          work_item_count: 1,
          open_work_item_count: 1,
          completed_count: 0,
        },
      ],
    };

    expect(
      buildWorkflowStageProgressSteps(
        {
          current_stage: 'implementation',
        },
        board as never,
      ),
    ).toEqual([
      { name: 'requirements', tone: 'done', detail: '2 complete' },
      { name: 'implementation', tone: 'active', detail: '2 open work items' },
      { name: 'verification', tone: 'attention', detail: 'Gate review waiting' },
    ]);

    expect(
      describeWorkflowStageProgressSummary(
        {
          current_stage: 'implementation',
        },
        board as never,
      ),
    ).toBe('1 of 3 stages complete • 2 active');
  });
});
