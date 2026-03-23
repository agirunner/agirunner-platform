import { describe, expect, it } from 'vitest';

import { gateRequiresSupersession } from '../../src/services/workflow-stage-gate-revisions.js';

describe('workflow-stage-gate-revisions', () => {
  it('supersedes stale gates by default when the subject revision advances', () => {
    expect(gateRequiresSupersession(3, 2, null, { approval_retention: 'invalidate_all' })).toBe(true);
  });

  it('preserves prior approval when retention allows non-material reviews to survive rework', () => {
    expect(
      gateRequiresSupersession(3, 2, null, {
        approval_retention: 'retain_non_material_only',
        materiality: 'non_material',
      }),
    ).toBe(false);
  });

  it('still supersedes retained approvals when the gate is material', () => {
    expect(
      gateRequiresSupersession(3, 2, null, {
        approval_retention: 'retain_non_material_only',
        materiality: 'material',
      }),
    ).toBe(true);
  });
});
