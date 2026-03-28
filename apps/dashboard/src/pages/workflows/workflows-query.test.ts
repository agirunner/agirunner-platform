import { describe, expect, it } from 'vitest';

import { buildWorkflowRailQueryKey } from './workflows-query.js';

describe('workflows query keys', () => {
  it('includes the selected workflow id in the rail query key so pinned selections refetch immediately', () => {
    expect(
      buildWorkflowRailQueryKey({
        mode: 'live',
        search: '',
        needsActionOnly: false,
        ongoingOnly: false,
        workflowId: 'workflow-1',
      }),
    ).toEqual([
      'workflows',
      'rail',
      'live',
      '',
      false,
      false,
      'workflow-1',
    ]);
    expect(
      buildWorkflowRailQueryKey({
        mode: 'live',
        search: '',
        needsActionOnly: false,
        ongoingOnly: false,
        workflowId: 'workflow-2',
      }),
    ).not.toEqual(
      buildWorkflowRailQueryKey({
        mode: 'live',
        search: '',
        needsActionOnly: false,
        ongoingOnly: false,
        workflowId: 'workflow-1',
      }),
    );
  });
});
