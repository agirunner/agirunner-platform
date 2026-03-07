import type { FastifyReply, FastifyRequest } from 'fastify';

import { ForbiddenError, UnauthorizedError } from '../errors/domain-errors.js';

export type RbacRole = 'viewer' | 'operator' | 'agent_admin' | 'workflow_admin' | 'org_admin';

const roleRank: Record<RbacRole, number> = {
  viewer: 1,
  operator: 2,
  agent_admin: 3,
  workflow_admin: 3,
  org_admin: 4,
};

export function hasRequiredRole(actual: RbacRole, required: RbacRole): boolean {
  return roleRank[actual] >= roleRank[required];
}

export function withRole(minimumRole: RbacRole) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!request.auth) {
      throw new UnauthorizedError();
    }

    const effectiveRole = request.auth.role ?? scopeToRole(request.auth.scope);

    if (!hasRequiredRole(effectiveRole, minimumRole)) {
      await request.server.auditService.record({
        tenantId: request.auth.tenantId,
        action: 'auth.request_denied',
        resourceType: 'system',
        outcome: 'failure',
        reason: 'insufficient_role',
        actorType: request.auth.ownerType,
        actorId: request.auth.ownerId,
        metadata: {
          path: request.url,
          method: request.method,
          required_role: minimumRole,
          actual_role: effectiveRole,
        },
      });
      throw new ForbiddenError(`Role '${effectiveRole}' cannot access endpoint requiring '${minimumRole}'`);
    }
  };
}

export function scopeToRole(scope: string): RbacRole {
  switch (scope) {
    case 'admin':
      return 'org_admin';
    case 'worker':
      return 'agent_admin';
    case 'agent':
      return 'viewer';
    default:
      return 'viewer';
  }
}

export function roleToScope(role: RbacRole): import('./scope.js').ApiKeyScope {
  switch (role) {
    case 'org_admin':
      return 'admin';
    case 'agent_admin':
    case 'workflow_admin':
      return 'worker';
    case 'operator':
    case 'viewer':
      return 'agent';
  }
}
