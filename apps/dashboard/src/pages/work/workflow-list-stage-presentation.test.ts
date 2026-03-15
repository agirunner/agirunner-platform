import { describe, expect, it } from 'vitest';

import {
  describeWorkflowStageFootnote,
  describeWorkflowStageLabel,
} from './workflow-list-stage-presentation.js';

describe('workflow list stage presentation', () => {
  it('uses lifecycle-aware stage labels', () => {
    expect(
      describeWorkflowStageLabel({
        id: 'wf-standard',
        name: 'Standard',
        status: 'running',
        created_at: '2026-03-11',
      }),
    ).toBe('Current stage');

    expect(
      describeWorkflowStageLabel({
        id: 'wf-continuous',
        name: 'Continuous',
        status: 'running',
        created_at: '2026-03-11',
        lifecycle: 'ongoing',
      }),
    ).toBe('Live stages');
  });

  it('keeps the stage footnote centered on live work before generic progress', () => {
    expect(
      describeWorkflowStageFootnote({
        id: 'wf-active',
        name: 'Active',
        status: 'running',
        created_at: '2026-03-11',
        lifecycle: 'ongoing',
        work_item_summary: {
          total_work_items: 4,
          open_work_item_count: 2,
          completed_work_item_count: 2,
          active_stage_count: 2,
          awaiting_gate_count: 0,
          active_stage_names: ['implementation', 'review'],
        },
      }),
    ).toBe('2 live stages');

    expect(
      describeWorkflowStageFootnote({
        id: 'wf-idle',
        name: 'Idle',
        status: 'pending',
        created_at: '2026-03-11',
        work_item_summary: {
          total_work_items: 0,
          open_work_item_count: 0,
          completed_work_item_count: 0,
          active_stage_count: 0,
          awaiting_gate_count: 0,
          active_stage_names: [],
        },
      }),
    ).toBe('No work items queued');
  });
});
