import { describe, expect, it } from 'vitest';

import { readTemplateLifecyclePolicy } from '../../src/services/task-lifecycle-policy.js';

describe('task lifecycle policy rework defaults', () => {
  it('defaults rework max cycles to 10 when the policy omits an explicit value', () => {
    expect(
      readTemplateLifecyclePolicy(
        {
          rework: {},
        },
        'metadata.lifecycle_policy',
      ),
    ).toEqual({
      rework: { max_cycles: 10 },
    });
  });
});
