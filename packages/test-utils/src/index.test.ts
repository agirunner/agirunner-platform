import { describe, expect, it } from 'vitest';

import { createBearerHeader, createTestIdentity } from './index.js';

describe('@agentbaton/test-utils exports', () => {
  it('creates default test identities with optional overrides', () => {
    const identity = createTestIdentity({ scope: 'worker', ownerType: 'worker', ownerId: 'worker-1' });

    expect(identity.tenantId).toBe('00000000-0000-0000-0000-000000000001');
    expect(identity.scope).toBe('worker');
    expect(identity.ownerType).toBe('worker');
    expect(identity.ownerId).toBe('worker-1');
  });

  it('creates bearer authorization headers', () => {
    expect(createBearerHeader('ab_worker_token')).toEqual({ authorization: 'Bearer ab_worker_token' });
  });
});
