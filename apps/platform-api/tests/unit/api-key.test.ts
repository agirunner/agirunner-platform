import bcrypt from 'bcryptjs';
import { describe, expect, it, vi } from 'vitest';

import { createApiKey, verifyApiKey } from '../../src/auth/api-key.js';

function makePool(queryImpl: ReturnType<typeof vi.fn>) {
  return {
    query: queryImpl,
  };
}

describe('createApiKey', () => {
  it('generates API keys in canonical ar_{scope}_{random} format with entropy-preserving key_prefix', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const pool = makePool(query);

    const { apiKey, keyPrefix } = await createApiKey(pool as never, {
      tenantId: '00000000-0000-0000-0000-000000000001',
      scope: 'worker',
      ownerType: 'worker',
      ownerId: 'worker-1',
      label: 'worker key',
      expiresAt: new Date(Date.now() + 60_000),
    });

    expect(apiKey.startsWith('ar_worker_')).toBe(true);
    expect(apiKey.length).toBeGreaterThan(20);
    expect(keyPrefix).toHaveLength(12);
    expect(keyPrefix).toMatch(/^k[A-Za-z0-9_-]{11}$/);
    expect(keyPrefix).not.toBe(apiKey.slice(0, 12));
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('retries key generation when key_prefix unique constraint collides', async () => {
    const duplicateError = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      constraint: 'idx_api_keys_prefix',
    });

    const query = vi
      .fn()
      .mockRejectedValueOnce(duplicateError)
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const pool = makePool(query);

    const result = await createApiKey(pool as never, {
      tenantId: '00000000-0000-0000-0000-000000000001',
      scope: 'agent',
      ownerType: 'agent',
      ownerId: 'agent-1',
      expiresAt: new Date(Date.now() + 60_000),
    });

    expect(result.apiKey).toContain('_agent_');
    expect(result.keyPrefix).toHaveLength(12);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('does not swallow unrelated database errors', async () => {
    const query = vi.fn().mockRejectedValue(new Error('database unavailable'));
    const pool = makePool(query);

    await expect(
      createApiKey(pool as never, {
        tenantId: '00000000-0000-0000-0000-000000000001',
        scope: 'admin',
        ownerType: 'user',
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).rejects.toThrow('database unavailable');

    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe('verifyApiKey', () => {
  it('accepts canonical keys with new prefix canonicalization and legacy compatibility fallback', async () => {
    const canonical = 'ar_admin_ABCDEFGHIJKLMNOPQRSTUV';
    const canonicalHash = await bcrypt.hash(canonical, 4);

    const queryNewPrefix = vi.fn().mockImplementation(async (_sql: string, params: unknown[]) => {
      const prefixes = params[0] as string[];
      return {
        rowCount: 1,
        rows: [
          {
            id: 'key-id-new',
            tenant_id: 'tenant-id',
            scope: 'admin',
            owner_type: 'user',
            owner_id: null,
            key_prefix: prefixes[0],
            key_hash: canonicalHash,
            is_revoked: false,
            expires_at: new Date(Date.now() + 60_000),
            tenant_is_active: true,
          },
        ],
      };
    });

    await expect(verifyApiKey(makePool(queryNewPrefix) as never, canonical)).resolves.toMatchObject({
      keyPrefix: expect.any(String),
    });

    const queryLegacyPrefix = vi.fn().mockImplementation(async (_sql: string, params: unknown[]) => {
      const prefixes = params[0] as string[];
      return {
        rowCount: 1,
        rows: [
          {
            id: 'key-id-legacy',
            tenant_id: 'tenant-id',
            scope: 'admin',
            owner_type: 'user',
            owner_id: null,
            key_prefix: prefixes[1],
            key_hash: canonicalHash,
            is_revoked: false,
            expires_at: new Date(Date.now() + 60_000),
            tenant_is_active: true,
          },
        ],
      };
    });

    await expect(verifyApiKey(makePool(queryLegacyPrefix) as never, canonical)).resolves.toMatchObject({
      keyPrefix: canonical.slice(0, 12),
    });
  });

  it('accepts legacy API key format', async () => {
    const legacy = 'ab_prefixxx_worker_ABCDEFGHIJKLMNOPQRSTUV';
    const legacyHash = await bcrypt.hash(legacy, 4);

    const query = vi.fn().mockImplementation(async (_sql: string, params: unknown[]) => {
      const prefixes = params[0] as string[];

      return {
        rowCount: 1,
        rows: [
          {
            id: 'legacy-id',
            tenant_id: 'tenant-id',
            scope: 'worker',
            owner_type: 'worker',
            owner_id: null,
            key_prefix: prefixes[0],
            key_hash: legacyHash,
            is_revoked: false,
            expires_at: new Date(Date.now() + 60_000),
            tenant_is_active: true,
          },
        ],
      };
    });

    await expect(verifyApiKey(makePool(query) as never, legacy)).resolves.toMatchObject({
      keyPrefix: legacy.slice(0, 12),
    });
  });

  it('derives distinct canonical lookup prefixes even when legacy first-12 prefix collides', async () => {
    const keyA = 'ar_worker_AA1234567890abcdefghijkl';
    const keyB = 'ar_worker_AAabcdefghij1234567890';

    const queryA = vi.fn().mockResolvedValue({ rowCount: 0, rows: [] });
    const queryB = vi.fn().mockResolvedValue({ rowCount: 0, rows: [] });

    await expect(verifyApiKey(makePool(queryA) as never, keyA)).rejects.toThrow('Invalid API key');
    await expect(verifyApiKey(makePool(queryB) as never, keyB)).rejects.toThrow('Invalid API key');

    const prefixesA = queryA.mock.calls[0][1][0] as string[];
    const prefixesB = queryB.mock.calls[0][1][0] as string[];

    expect(prefixesA[1]).toBe(keyA.slice(0, 12));
    expect(prefixesB[1]).toBe(keyB.slice(0, 12));
    expect(prefixesA[1]).toBe(prefixesB[1]);
    expect(prefixesA[0]).not.toBe(prefixesB[0]);
  });

  it('rejects invalid API key format', async () => {
    const query = vi.fn();
    await expect(verifyApiKey(makePool(query) as never, 'ab_invalid')).rejects.toThrow('Invalid API key format');
    expect(query).not.toHaveBeenCalled();
  });
});
