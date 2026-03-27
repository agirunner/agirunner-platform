import { describe, expect, it } from 'vitest';

import {
  buildWorkflowDetailHash,
  buildWorkflowDetailPermalink,
} from './workflow-detail-permalinks.js';

describe('workflow detail permalinks', () => {
  it('maps workflow operator links into unified mission control shell state', () => {
    expect(buildWorkflowDetailPermalink('workflow-1', {})).toBe(
      '/mission-control?rail=workflow&workflow=workflow-1',
    );
    expect(
      buildWorkflowDetailPermalink('workflow-1', {
        workItemId: 'work-item-9',
      }),
    ).toBe(
      '/mission-control?rail=workflow&workflow=workflow-1&tab=board#work-item-work-item-9',
    );
    expect(
      buildWorkflowDetailPermalink('workflow-1', {
        activationId: 'activation-4',
      }),
    ).toBe(
      '/mission-control?rail=workflow&workflow=workflow-1&tab=history#activation-activation-4',
    );
  });

  it('keeps legacy hash generation stable for focus targets', () => {
    expect(buildWorkflowDetailHash({ gateStageName: 'review' })).toBe('#gate-review');
    expect(buildWorkflowDetailHash({ childWorkflowId: 'child-2' })).toBe(
      '#child-workflow-child-2',
    );
  });
});
