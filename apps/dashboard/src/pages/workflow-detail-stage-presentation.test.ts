import { describe, expect, it } from 'vitest';

import { deriveWorkflowStageDisplay } from './workflow-detail-stage-presentation.js';

describe('workflow detail stage presentation', () => {
  it('uses lifecycle-aware live-stage semantics for ongoing workflows', () => {
    expect(
      deriveWorkflowStageDisplay({
        lifecycle: 'ongoing',
        current_stage: 'legacy-review',
        work_item_summary: {
          active_stage_names: ['implementation', 'verification'],
        },
      }),
    ).toEqual({
      label: 'Live stages',
      badgeValue: 'implementation, verification',
      detailValue: 'implementation, verification',
    });

    expect(
      deriveWorkflowStageDisplay({
        lifecycle: 'ongoing',
      }),
    ).toEqual({
      label: 'Live stages',
      badgeValue: null,
      detailValue: 'No live stages',
    });
  });

  it('keeps planned workflows on current-stage semantics with readable empty copy', () => {
    expect(
      deriveWorkflowStageDisplay({
        current_stage: 'review',
      }),
    ).toEqual({
      label: 'Current stage',
      badgeValue: 'review',
      detailValue: 'review',
    });

    expect(
      deriveWorkflowStageDisplay({
      }),
    ).toEqual({
      label: 'Current stage',
      badgeValue: null,
      detailValue: 'No current stage',
    });
  });
});
