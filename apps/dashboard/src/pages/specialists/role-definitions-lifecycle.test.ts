import { describe, expect, it } from 'vitest';

import {
  canDeleteRole,
  describeRoleLifecyclePolicy,
} from './role-definitions-lifecycle.js';

describe('role definitions lifecycle helpers', () => {
  it('allows deletion for active roles and warns to update dependent workflows first', () => {
    expect(canDeleteRole({ is_active: true })).toBe(true);
    expect(
      describeRoleLifecyclePolicy({ is_active: true }),
    ).toContain('Update any playbooks that still reference it before deletion');
  });

  it('allows deletion for inactive roles', () => {
    expect(canDeleteRole({ is_active: false })).toBe(true);
    expect(
      describeRoleLifecyclePolicy({ is_active: false }),
    ).toContain('can be deleted');
  });
});
