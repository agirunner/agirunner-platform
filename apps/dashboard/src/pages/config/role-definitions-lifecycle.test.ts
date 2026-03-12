import { describe, expect, it } from 'vitest';

import {
  canDeleteRole,
  describeRoleLifecyclePolicy,
} from './role-definitions-lifecycle.js';

describe('role definitions lifecycle helpers', () => {
  it('blocks deletion for built-in roles', () => {
    expect(canDeleteRole({ is_built_in: true })).toBe(false);
    expect(
      describeRoleLifecyclePolicy({ is_built_in: true, is_active: true }),
    ).toContain('Built-in roles are protected');
  });

  it('allows deletion for inactive custom roles', () => {
    expect(canDeleteRole({ is_built_in: false })).toBe(true);
    expect(
      describeRoleLifecyclePolicy({ is_built_in: false, is_active: false }),
    ).toContain('can be deleted');
  });

  it('warns before deleting active custom roles', () => {
    expect(
      describeRoleLifecyclePolicy({ is_built_in: false, is_active: true }),
    ).toContain('Update playbooks before deleting');
  });
});
