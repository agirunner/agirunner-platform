import { describe, expect, it } from 'vitest';

import { createLogServiceHarness } from './logging-log-service-support.js';

describe('LogService', () => {
  describe('export', () => {
    it('exports inspector logs across multiple keyset pages without over-fetching page size', async () => {
      const { pool, service } = createLogServiceHarness();
      pool.query
        .mockResolvedValueOnce({
          rows: [
            { id: 'log-3', created_at: '2026-03-09T12:00:03.000Z' },
            { id: 'log-2', created_at: '2026-03-09T12:00:02.000Z' },
            { id: 'log-1', created_at: '2026-03-09T12:00:01.000Z' },
          ],
          rowCount: 3,
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'log-0', created_at: '2026-03-09T12:00:00.000Z' }],
          rowCount: 1,
        });

      const exportedIds: string[] = [];
      for await (const row of service.export('tenant-1', { perPage: 2 })) {
        exportedIds.push(String(row.id));
      }

      expect(exportedIds).toEqual(['log-3', 'log-2', 'log-0']);
      expect(pool.query).toHaveBeenCalledTimes(2);
      expect(pool.query.mock.calls[0][1]?.at(-1)).toBe(3);
      expect(pool.query.mock.calls[1][1]).toContain('log-2');
      expect(pool.query.mock.calls[1][1]?.at(-1)).toBe(3);
    });

    it('exports inspector logs deterministically across multiple full pages with stable cursors', async () => {
      const { pool, service } = createLogServiceHarness();
      pool.query
        .mockResolvedValueOnce({
          rows: [
            { id: 'log-5', created_at: '2026-03-09T12:00:05.000Z' },
            { id: 'log-4', created_at: '2026-03-09T12:00:04.000Z' },
            { id: 'log-3', created_at: '2026-03-09T12:00:03.000Z' },
          ],
          rowCount: 3,
        })
        .mockResolvedValueOnce({
          rows: [
            { id: 'log-3', created_at: '2026-03-09T12:00:03.000Z' },
            { id: 'log-2', created_at: '2026-03-09T12:00:02.000Z' },
            { id: 'log-1', created_at: '2026-03-09T12:00:01.000Z' },
          ],
          rowCount: 3,
        })
        .mockResolvedValueOnce({
          rows: [
            { id: 'log-1', created_at: '2026-03-09T12:00:01.000Z' },
            { id: 'log-0', created_at: '2026-03-09T12:00:00.000Z' },
          ],
          rowCount: 2,
        });

      const exportedIds: string[] = [];
      for await (const row of service.export('tenant-1', { perPage: 2 })) {
        exportedIds.push(String(row.id));
      }

      expect(exportedIds).toEqual(['log-5', 'log-4', 'log-3', 'log-2', 'log-1', 'log-0']);
      expect(pool.query).toHaveBeenCalledTimes(3);
      expect(pool.query.mock.calls[0][1]?.at(-1)).toBe(3);
      expect(pool.query.mock.calls[1][1]).toContain('log-4');
      expect(pool.query.mock.calls[1][1]?.at(-1)).toBe(3);
      expect(pool.query.mock.calls[2][1]).toContain('log-2');
      expect(pool.query.mock.calls[2][1]?.at(-1)).toBe(3);
    });

    it('yieldsAllRowsAcrossMultiplePages', async () => {
      const { pool, service } = createLogServiceHarness();
      const page1 = Array.from({ length: 3 }, (_, index) => ({
        id: String(index),
        created_at: `2026-03-09T12:00:0${index}.000Z`,
      }));
      const page2 = [{ id: '3', created_at: '2026-03-09T12:00:03.000Z' }];
      pool.query
        .mockResolvedValueOnce({
          rows: [...page1, { id: '99', created_at: '2026-03-09T12:00:04.000Z' }],
          rowCount: 4,
        })
        .mockResolvedValueOnce({ rows: page2, rowCount: 1 });

      const rows: unknown[] = [];
      for await (const row of service.export('tenant-1', { perPage: 3 })) {
        rows.push(row);
      }

      expect(rows).toHaveLength(4);
    });

    it('reuses capped keyset page sizes during large exports', async () => {
      const { pool, service } = createLogServiceHarness();
      const page1 = Array.from({ length: 501 }, (_, index) => ({
        id: String(index),
        created_at: `2026-03-09T12:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`,
      }));
      const page2 = [{ id: '999', created_at: '2026-03-09T13:00:00.000Z' }];
      pool.query
        .mockResolvedValueOnce({ rows: page1, rowCount: 501 })
        .mockResolvedValueOnce({ rows: page2, rowCount: 1 });

      const rows: unknown[] = [];
      for await (const row of service.export('tenant-1', { perPage: 9999 })) {
        rows.push(row);
      }

      expect(rows).toHaveLength(501);
      expect(pool.query).toHaveBeenCalledTimes(2);
      expect((pool.query.mock.calls[0]?.[1] as unknown[]).at(-1)).toBe(501);
      expect((pool.query.mock.calls[1]?.[1] as unknown[]).at(-1)).toBe(501);
    });
  });
});
