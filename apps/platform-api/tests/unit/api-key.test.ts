import { describe, expect, it, vi } from 'vitest';

import { createApiKey } from '../../src/auth/api-key.js';

function makePool(queryImpl: ReturnType<typeof vi.fn>) {
  return {
    query: queryImpl,
  };
}

describe('createApiKey', () => {
  it('generates API keys with high-entropy prefixes while preserving scope marker', async () => {
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

    expect(apiKey.startsWith('ab_')).toBe(true);
    expect(apiKey).toContain('_worker_');
    expect(apiKey.length).toBeGreaterThan(20);
    expect(keyPrefix).toBe(apiKey.slice(0, 12));
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
