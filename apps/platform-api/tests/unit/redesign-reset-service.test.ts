import { describe, expect, it, vi } from 'vitest';

import {
  PlaybookRedesignResetService,
  PLAYBOOK_REDESIGN_PRESERVED_TABLES,
} from '../../src/services/redesign-reset-service.js';

describe('PlaybookRedesignResetService', () => {
  it('truncates redesign state and reseeds preserved bootstrap configuration', async () => {
    const client = {
      query: vi.fn(async () => ({ rowCount: 0, rows: [] })),
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn(async () => client),
    };
    const seedDefaultTenant = vi.fn(async () => undefined);
    const seedConfigTables = vi.fn(async () => undefined);

    const service = new PlaybookRedesignResetService(pool as never, {
      seedDefaultTenant,
      seedConfigTables,
    });

    await service.reset({ AGIRUNNER_ADMIN_EMAIL: 'admin@example.com' } as never);

    expect(client.query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(client.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('DELETE FROM api_keys'),
      [expect.any(String)],
    );
    const truncateSql = String((client.query.mock.calls[2] as unknown[] | undefined)?.[0] ?? '');
    expect(truncateSql).toContain('TRUNCATE TABLE');
    for (const table of PLAYBOOK_REDESIGN_PRESERVED_TABLES) {
      expect(truncateSql).not.toContain(`public.${table}`);
    }
    expect(seedDefaultTenant).toHaveBeenCalledWith(client, expect.any(Object));
    expect(seedConfigTables).toHaveBeenCalledWith(client, {
      AGIRUNNER_ADMIN_EMAIL: 'admin@example.com',
    });
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('rolls back when reseeding fails', async () => {
    const client = {
      query: vi.fn(async () => ({ rowCount: 0, rows: [] })),
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn(async () => client),
    };
    const seedError = new Error('seed failed');
    const service = new PlaybookRedesignResetService(pool as never, {
      seedDefaultTenant: vi.fn(async () => undefined),
      seedConfigTables: vi.fn(async () => {
        throw seedError;
      }),
    });

    await expect(service.reset()).rejects.toThrow('seed failed');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
