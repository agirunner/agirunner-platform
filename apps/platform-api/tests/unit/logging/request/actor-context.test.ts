import { describe, expect, it } from 'vitest';

import { actorFromAuth } from '../../../../src/logging/request/actor-context.js';
import type { ApiKeyIdentity } from '../../../src/auth/api-key.js';

describe('actorFromAuth', () => {
  it('returnsSystemActorWhenAuthIsUndefined', () => {
    const actor = actorFromAuth(undefined);
    expect(actor).toEqual({ type: 'system', id: 'system', name: 'System' });
  });

  it('returnsUserActorForAdminScopeWithUserId', () => {
    const auth: ApiKeyIdentity = {
      id: 'key-1',
      tenantId: 'tenant-1',
      scope: 'admin',
      ownerType: 'user',
      ownerId: 'user-1',
      keyPrefix: 'kABCDEFGHIJK',
      userId: 'user-1',
    };
    const actor = actorFromAuth(auth);
    expect(actor.type).toBe('user');
    expect(actor.id).toBe('user-1');
  });

  it('returnsApiKeyActorForAdminScopeWithoutUserId', () => {
    const auth: ApiKeyIdentity = {
      id: 'key-1',
      tenantId: 'tenant-1',
      scope: 'admin',
      ownerType: 'system',
      ownerId: null,
      keyPrefix: 'kABCDEFGHIJK',
    };
    const actor = actorFromAuth(auth);
    expect(actor.type).toBe('api_key');
    expect(actor.id).toBe('key-1');
    expect(actor.name).toBe('Admin API');
  });

  it('returnsWorkerActorForWorkerScope', () => {
    const auth: ApiKeyIdentity = {
      id: 'key-2',
      tenantId: 'tenant-1',
      scope: 'worker',
      ownerType: 'worker',
      ownerId: 'worker-1',
      keyPrefix: 'kWORKER12345',
    };
    const actor = actorFromAuth(auth);
    expect(actor.type).toBe('worker');
    expect(actor.id).toBe('worker-1');
  });

  it('returnsAgentActorForAgentScope', () => {
    const auth: ApiKeyIdentity = {
      id: 'key-3',
      tenantId: 'tenant-1',
      scope: 'agent',
      ownerType: 'agent',
      ownerId: 'agent-1',
      keyPrefix: 'kAGENT123456',
    };
    const actor = actorFromAuth(auth);
    expect(actor.type).toBe('agent');
    expect(actor.id).toBe('agent-1');
  });

  it('renames worker-scope actor for orchestrator-owned task logs', () => {
    const auth: ApiKeyIdentity = {
      id: 'key-2',
      tenantId: 'tenant-1',
      scope: 'worker',
      ownerType: 'worker',
      ownerId: 'worker-1',
      keyPrefix: 'kWORKER12345',
    };

    const actor = actorFromAuth(auth, { role: 'orchestrator', isOrchestratorTask: true });

    expect(actor).toEqual({
      type: 'worker',
      id: 'worker-1',
      name: 'Orchestrator agent',
    });
  });

  it('renames agent-scope actor for orchestrator-owned execution logs', () => {
    const auth: ApiKeyIdentity = {
      id: 'key-3',
      tenantId: 'tenant-1',
      scope: 'agent',
      ownerType: 'agent',
      ownerId: 'agent-1',
      keyPrefix: 'kAGENT123456',
    };

    const actor = actorFromAuth(auth, { isOrchestratorTask: true });

    expect(actor).toEqual({
      type: 'agent',
      id: 'agent-1',
      name: 'Orchestrator execution',
    });
  });

  it('fallsBackToKeyIdWhenOwnerIdIsNull', () => {
    const auth: ApiKeyIdentity = {
      id: 'key-4',
      tenantId: 'tenant-1',
      scope: 'worker',
      ownerType: 'worker',
      ownerId: null,
      keyPrefix: 'kFALLBACK123',
    };
    const actor = actorFromAuth(auth);
    expect(actor.type).toBe('worker');
    expect(actor.id).toBe('key-4');
  });
});
