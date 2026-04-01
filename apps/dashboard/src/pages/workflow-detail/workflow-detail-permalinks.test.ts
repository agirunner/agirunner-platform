import { describe, expect, it } from 'vitest';

import {
  buildWorkflowDetailHash,
  buildWorkflowDetailPermalink,
} from '../../app/routes/workflow-navigation.js';

describe('workflow detail permalinks', () => {
  it('maps workflow operator links into the workflows shell state', () => {
    expect(buildWorkflowDetailPermalink('workflow-1', {})).toBe(
      '/workflows/workflow-1',
    );
    expect(
      buildWorkflowDetailPermalink('workflow-1', {
        workItemId: 'work-item-9',
      }),
    ).toBe(
      '/workflows/workflow-1?work_item_id=work-item-9#work-item-work-item-9',
    );
    expect(
      buildWorkflowDetailPermalink('workflow-1', {
        activationId: 'activation-4',
      }),
    ).toBe(
      '/workflows/workflow-1?tab=live_console#activation-activation-4',
    );
  });

  it('keeps legacy hash generation stable for focus targets', () => {
    expect(buildWorkflowDetailHash({ gateStageName: 'review' })).toBe('#gate-review');
    expect(buildWorkflowDetailHash({ childWorkflowId: 'child-2' })).toBe(
      '#child-workflow-child-2',
    );
  });
});
