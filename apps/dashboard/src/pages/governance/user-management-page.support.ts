export const ROLES = ['viewer', 'operator', 'agent_admin', 'workflow_admin', 'org_admin'] as const;
export type UserRole = (typeof ROLES)[number];
export type RoleBadgeVariant = 'default' | 'success' | 'destructive' | 'warning' | 'secondary';

export interface User {
  id: string;
  email: string;
  display_name: string;
  role: string;
  status: string;
  last_login?: string | null;
  created_at?: string;
}

export interface CreateUserPayload {
  email: string;
  display_name: string;
  role: string;
}

export interface UpdateUserPayload {
  role?: string;
  status?: string;
}

const ROLE_VARIANT: Record<string, RoleBadgeVariant> = {
  org_admin: 'destructive',
  workflow_admin: 'warning',
  agent_admin: 'warning',
  operator: 'default',
  viewer: 'secondary',
};

const ROLE_DESCRIPTION: Record<string, string> = {
  viewer: 'Read-only access for people who monitor posture without changing platform state.',
  operator: 'Operational access for routine workflow and runtime actions without org-wide governance control.',
  agent_admin: 'Agent inventory and assignment control for teams managing automation capacity.',
  workflow_admin: 'Workflow orchestration and lifecycle control across projects and playbooks.',
  org_admin: 'Tenant-wide administration. Reserve for trusted administrators only.',
};

export function roleVariant(role: string): RoleBadgeVariant {
  return ROLE_VARIANT[role.toLowerCase()] ?? 'secondary';
}

export function formatRoleLabel(role: string): string {
  return role.replace(/_/g, ' ');
}

export function describeRole(role: string): string {
  return ROLE_DESCRIPTION[role.toLowerCase()] ?? 'Choose the smallest role that still lets this person finish their work.';
}

export function summarizeUsers(users: User[]) {
  return {
    total: users.length,
    active: users.filter((user) => user.status === 'active').length,
    admins: users.filter((user) => user.role.endsWith('_admin')).length,
    inactive: users.filter((user) => user.status !== 'active').length,
  };
}
