import type { RoleDefinition } from './role-definitions-page.support.js';

export function canDeleteRole(_role: Pick<RoleDefinition, 'is_active'>): boolean {
  return true;
}

export function describeRoleLifecyclePolicy(
  role: Pick<RoleDefinition, 'is_active'>,
): string {
  if (role.is_active === false) {
    return 'This role is inactive and can be deleted when it is no longer needed.';
  }
  return 'This role is active. Update any playbooks that still reference it before deletion.';
}
