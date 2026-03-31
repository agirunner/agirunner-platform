import { describe, expect, it } from 'vitest';

import { buildWorkflowRailQueryKey } from './workflows-query.js';

describe('workflows query keys', () => {
  it('keeps the rail query key stable when selection changes so selection is not treated like a sort key', () => {
    expect(
      buildWorkflowRailQueryKey({
        mode: 'live',
        search: '',
        needsActionOnly: false,
        lifecycleFilter: 'all',
        playbookId: null,
        updatedWithin: 'all',
      }),
    ).toEqual([
      'workflows',
      'rail',
      'live',
      '',
      false,
      'all',
      null,
      'all',
    ]);
    expect(
      buildWorkflowRailQueryKey({
        mode: 'live',
        search: '',
        needsActionOnly: false,
        lifecycleFilter: 'all',
        playbookId: null,
        updatedWithin: 'all',
      }),
    ).toEqual(
      buildWorkflowRailQueryKey({
        mode: 'live',
        search: '',
        needsActionOnly: false,
        lifecycleFilter: 'all',
        playbookId: null,
        updatedWithin: 'all',
      }),
    );
  });
});
