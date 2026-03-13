import { describe, expect, it } from 'vitest';

import {
  describeWorkflowScopeSummary,
  describeWorkflowStageLabel,
  describeWorkflowStageValue,
} from './workflow-inspector-stage-presentation.js';

describe('workflow inspector stage presentation', () => {
  it('uses lifecycle-aware stage labels', () => {
    expect(describeWorkflowStageLabel(undefined)).toBe('Current stage');
    expect(
      describeWorkflowStageLabel({
        lifecycle: 'continuous',
      }),
    ).toBe('Live stages');
  });

  it('prefers live work-item stages and readable empty states', () => {
    expect(
      describeWorkflowStageValue({
        lifecycle: 'continuous',
        current_stage: 'legacy-review',
        work_item_summary: {
          active_stage_names: ['implementation', 'verification'],
        },
      }),
    ).toBe('implementation, verification');

    expect(
      describeWorkflowStageValue({
        lifecycle: 'continuous',
      }),
    ).toBe('No live stages');

    expect(
      describeWorkflowStageValue({
        current_stage: 'review',
      }),
    ).toBe('review');

    expect(describeWorkflowStageValue(undefined)).toBe('No current stage');
  });

  it('builds a labeled operator-scope summary', () => {
    expect(
      describeWorkflowScopeSummary({
        lifecycle: 'continuous',
        active_stages: ['implementation'],
      }),
    ).toBe('Live stages: implementation');

    expect(
      describeWorkflowScopeSummary({
        current_stage: 'review',
      }),
    ).toBe('Current stage: review');
  });
});
