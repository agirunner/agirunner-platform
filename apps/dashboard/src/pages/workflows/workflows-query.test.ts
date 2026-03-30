import { describe, expect, it } from 'vitest';

import { buildWorkflowRailQueryKey } from './workflows-query.js';

describe('workflows query keys', () => {
  it('keeps the rail query key stable when selection changes so selection is not treated like a sort key', () => {
    expect(
      buildWorkflowRailQueryKey({
        mode: 'live',
        search: '',
        needsActionOnly: false,
        ongoingOnly: false,
      }),
    ).toEqual([
      'workflows',
      'rail',
      'live',
      '',
      false,
      false,
    ]);
    expect(
      buildWorkflowRailQueryKey({
        mode: 'live',
        search: '',
        needsActionOnly: false,
        ongoingOnly: false,
      }),
    ).toEqual(
      buildWorkflowRailQueryKey({
        mode: 'live',
        search: '',
        needsActionOnly: false,
        ongoingOnly: false,
      }),
    );
  });
});
