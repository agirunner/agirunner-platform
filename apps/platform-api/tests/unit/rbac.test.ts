import { describe, expect, it } from 'vitest';

import { hasRequiredRole, scopeToRole, roleToScope, type RbacRole } from '../../src/auth/rbac.js';

describe('RBAC', () => {
  describe('hasRequiredRole', () => {
    it('allows org_admin to access all roles', () => {
      const roles: RbacRole[] = ['viewer', 'operator', 'agent_admin', 'workflow_admin', 'org_admin'];
      for (const required of roles) {
        expect(hasRequiredRole('org_admin', required)).toBe(true);
      }
    });

    it('allows operator to access viewer endpoints', () => {
      expect(hasRequiredRole('operator', 'viewer')).toBe(true);
    });

    it('denies viewer access to operator endpoints', () => {
      expect(hasRequiredRole('viewer', 'operator')).toBe(false);
    });

    it('denies operator access to org_admin endpoints', () => {
      expect(hasRequiredRole('operator', 'org_admin')).toBe(false);
    });

    it('treats agent_admin and workflow_admin as equal rank', () => {
      expect(hasRequiredRole('agent_admin', 'workflow_admin')).toBe(true);
      expect(hasRequiredRole('workflow_admin', 'agent_admin')).toBe(true);
    });

    it('allows agent_admin to access operator endpoints', () => {
      expect(hasRequiredRole('agent_admin', 'operator')).toBe(true);
    });

    it('denies agent_admin access to org_admin endpoints', () => {
      expect(hasRequiredRole('agent_admin', 'org_admin')).toBe(false);
    });
  });

  describe('scopeToRole', () => {
    it('maps admin scope to org_admin', () => {
      expect(scopeToRole('admin')).toBe('org_admin');
    });

    it('maps worker scope to agent_admin', () => {
      expect(scopeToRole('worker')).toBe('agent_admin');
    });

    it('maps agent scope to viewer', () => {
      expect(scopeToRole('agent')).toBe('viewer');
    });

    it('maps unknown scope to viewer', () => {
      expect(scopeToRole('unknown')).toBe('viewer');
    });
  });

  describe('roleToScope', () => {
    it('maps org_admin to admin', () => {
      expect(roleToScope('org_admin')).toBe('admin');
    });

    it('maps agent_admin to worker', () => {
      expect(roleToScope('agent_admin')).toBe('worker');
    });

    it('maps workflow_admin to worker', () => {
      expect(roleToScope('workflow_admin')).toBe('worker');
    });

    it('maps operator to agent', () => {
      expect(roleToScope('operator')).toBe('agent');
    });

    it('maps viewer to agent', () => {
      expect(roleToScope('viewer')).toBe('agent');
    });
  });
});
