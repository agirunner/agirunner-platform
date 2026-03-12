import type { RoleDefinition } from './role-definitions-page.support.js';

export function canDeleteRole(role: Pick<RoleDefinition, 'is_built_in'>): boolean {
  return role.is_built_in !== true;
}

export function describeRoleLifecyclePolicy(
  role: Pick<RoleDefinition, 'is_built_in' | 'is_active'>,
): string {
  if (!canDeleteRole(role)) {
    return 'Built-in roles are protected and can only be deactivated.';
  }
  if (role.is_active === false) {
    return 'Custom role is inactive and can be deleted when it is no longer needed.';
  }
  return 'Custom role is active. Update playbooks before deleting it from the catalog.';
}
