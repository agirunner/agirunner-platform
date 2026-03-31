import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/auth/api-key.js', () => ({
  createApiKey: vi.fn(),
}));

import { createApiKey } from '../../../../src/auth/api-key.js';
import { ApiKeyService } from '../../../../src/services/api-key-service.js';

const mockedCreateApiKey = vi.mocked(createApiKey);

describe('api key service', () => {
  it('filters operator keys revoked more than one hour ago from dashboard listings', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rowCount: 4,
        rows: [
          {
            id: 'admin-old-revoked',
            tenant_id: 'tenant-1',
            scope: 'admin',
            owner_type: 'user',
            owner_id: null,
            label: 'old admin revoke',
            key_prefix: 'kadminold01',
            last_used_at: null,
            expires_at: new Date('2026-04-01T00:00:00.000Z').toISOString(),
            is_revoked: true,
            revoked_at: new Date('2026-03-24T08:30:00.000Z').toISOString(),
            created_at: new Date('2026-03-20T00:00:00.000Z').toISOString(),
          },
          {
            id: 'service-recent-revoked',
            tenant_id: 'tenant-1',
            scope: 'service',
            owner_type: 'service',
            owner_id: null,
            label: 'recent service revoke',
            key_prefix: 'kservicenew',
            last_used_at: null,
            expires_at: new Date('2026-04-01T00:00:00.000Z').toISOString(),
            is_revoked: true,
            revoked_at: new Date('2026-03-24T09:30:00.000Z').toISOString(),
            created_at: new Date('2026-03-24T08:00:00.000Z').toISOString(),
          },
          {
            id: 'worker-old-revoked',
            tenant_id: 'tenant-1',
            scope: 'worker',
            owner_type: 'worker',
            owner_id: 'worker-1',
            label: 'worker key',
            key_prefix: 'kworkerold1',
            last_used_at: null,
            expires_at: new Date('2026-04-01T00:00:00.000Z').toISOString(),
            is_revoked: true,
            revoked_at: new Date('2026-03-24T09:00:00.000Z').toISOString(),
            created_at: new Date('2026-03-24T08:00:00.000Z').toISOString(),
          },
          {
            id: 'service-active',
            tenant_id: 'tenant-1',
            scope: 'service',
            owner_type: 'service',
            owner_id: null,
            label: 'active service key',
            key_prefix: 'kserviceact',
            last_used_at: null,
            expires_at: new Date('2026-04-01T00:00:00.000Z').toISOString(),
            is_revoked: false,
            revoked_at: null,
            created_at: new Date('2026-03-24T07:00:00.000Z').toISOString(),
          },
        ],
      }),
    };

    const service = new ApiKeyService(pool as never);

    const result = await service.listApiKeys('tenant-1', new Date('2026-03-24T10:00:00.000Z'));

    expect(result.map((row) => row.id)).toEqual([
      'service-recent-revoked',
      'worker-old-revoked',
      'service-active',
    ]);
  });

  it('passes no-expiry operator keys through without forcing an expiry timestamp', async () => {
    const pool = {
      query: vi.fn(),
    };
    mockedCreateApiKey.mockResolvedValueOnce({ apiKey: 'ar_service_test', keyPrefix: 'kservice001' });
    const service = new ApiKeyService(pool as never);
    const identity = {
      id: 'admin-key',
      tenantId: 'tenant-1',
      scope: 'admin' as const,
      ownerType: 'user',
      ownerId: null,
      keyPrefix: 'kadmin000001',
    };

    await expect(
      service.createApiKey(identity, {
        scope: 'service',
        label: 'Persistent integration',
        expires_at: null,
      } as never),
    ).resolves.toMatchObject({
      api_key: expect.any(String),
      key_prefix: expect.any(String),
    });
    expect(mockedCreateApiKey).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        scope: 'service',
        ownerType: 'service',
        expiresAt: undefined,
      }),
    );
  });
});
