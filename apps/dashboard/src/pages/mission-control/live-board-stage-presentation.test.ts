import { describe, expect, it } from 'vitest';

import {
  describeWorkflowStageLabel,
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
});
