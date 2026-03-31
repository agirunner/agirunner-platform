import { vi } from 'vitest';

import { configureProviderSecretEncryptionKey } from '../../../src/lib/oauth-crypto.js';

configureProviderSecretEncryptionKey('test-encryption-key');

export function createIdentity() {
  return {
    tenantId: 'tenant-1',
    scope: 'admin',
    ownerType: 'tenant',
    ownerId: 'tenant-1',
    keyPrefix: 'admin-key',
    id: 'key-1',
  };
}

export function createEventService() {
  return { emit: vi.fn(async () => undefined) };
}
