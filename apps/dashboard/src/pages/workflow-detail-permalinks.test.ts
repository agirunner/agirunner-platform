import { describe, expect, it } from 'vitest';

import {
  buildWorkflowDetailPermalink,
  isWorkflowDetailTargetHighlighted,
} from './workflow-detail-permalinks.js';

describe('workflow detail permalinks', () => {
  it('builds stable work item, activation, child workflow, and gate permalinks', () => {
    expect(
      buildWorkflowDetailPermalink('workflow-1', { workItemId: 'work-item-1' }),
    ).toBe('/work/workflows/workflow-1?work_item=work-item-1#work-item-work-item-1');
    expect(
      buildWorkflowDetailPermalink('workflow-1', { activationId: 'activation-1' }),
    ).toBe('/work/workflows/workflow-1?activation=activation-1#activation-activation-1');
    expect(
      buildWorkflowDetailPermalink('workflow-1', { childWorkflowId: 'workflow-2' }),
    ).toBe('/work/workflows/workflow-1?child=workflow-2#child-workflow-workflow-2');
    expect(
      buildWorkflowDetailPermalink('workflow-1', { gateStageName: 'review' }),
    ).toBe('/work/workflows/workflow-1?gate=review#gate-review');
  });

  it('matches highlighted workflow detail targets from query or hash', () => {
    expect(
      isWorkflowDetailTargetHighlighted('?work_item=work-item-1', '', 'work_item', 'work-item-1'),
    ).toBe(true);
    expect(
      isWorkflowDetailTargetHighlighted('', '#activation-activation-1', 'activation', 'activation-1'),
    ).toBe(true);
    expect(
      isWorkflowDetailTargetHighlighted('?child=workflow-2', '', 'child', 'workflow-1'),
    ).toBe(false);
    expect(
      isWorkflowDetailTargetHighlighted('', '#gate-review', 'gate', 'review'),
    ).toBe(true);
  });
});
