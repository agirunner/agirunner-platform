import { describe, expect, it, vi } from 'vitest';

import { LogLevelCache } from '../../../src/logging/log-level-cache.js';

function createPool(result: { rowCount?: number; rows?: Array<{ level: string | null }> } = {}) {
  return {
    query: vi.fn().mockResolvedValue({
      rowCount: result.rowCount ?? 0,
      rows: result.rows ?? [],
    }),
  };
}

describe('LogLevelCache', () => {
  it('defaults to debug when no tenant override exists', async () => {
    const pool = createPool();
    const cache = new LogLevelCache(pool as never);

    await expect(cache.getLevel('tenant-1')).resolves.toBe('debug');
  });

  it('returns the stored tenant override when present', async () => {
    const pool = createPool({ rowCount: 1, rows: [{ level: 'warn' }] });
    const cache = new LogLevelCache(pool as never);

    await expect(cache.getLevel('tenant-1')).resolves.toBe('warn');
  });
});
