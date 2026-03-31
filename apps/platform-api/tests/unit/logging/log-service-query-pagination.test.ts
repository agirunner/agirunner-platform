import { describe, expect, it } from 'vitest';

import { decodeCursor, encodeCursor } from '../../../src/logging/log-service.js';
import { createLogServiceHarness } from './support.js';

describe('LogService', () => {
  describe('query pagination', () => {
    it('handlesKeysetPaginationWithCursor', async () => {
      const { pool, service } = createLogServiceHarness();
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await service.query('tenant-1', { cursor: encodeCursor('500', '2026-03-09T12:00:00.000Z') });

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('(l.created_at, l.id) <');
      expect(params).toContain('2026-03-09T12:00:00.000Z');
      expect(params).toContain('500');
    });

    it('setsHasMoreWhenMoreRowsExist', async () => {
      const { pool, service } = createLogServiceHarness();
      pool.query.mockResolvedValue({
        rows: Array.from({ length: 11 }, (_, index) => ({
          id: String(index),
          created_at: `2026-03-09T12:00:0${index}.000Z`,
        })),
        rowCount: 11,
      });

      const result = await service.query('tenant-1', { perPage: 10 });
      expect(result.pagination.has_more).toBe(true);
      expect(result.data).toHaveLength(10);
      expect(result.pagination.next_cursor).toBeTruthy();
    });

    it('preserves microsecond cursor precision across keyset pages', async () => {
      const { pool, service } = createLogServiceHarness();
      pool.query.mockResolvedValue({
        rows: Array.from({ length: 11 }, (_, index) => ({
          id: String(index),
          created_at: `2026-03-09T12:00:${String(index).padStart(2, '0')}.454Z`,
          cursor_created_at:
            index === 9
              ? '2026-03-09T12:00:09.454911Z'
              : `2026-03-09T12:00:${String(index).padStart(2, '0')}.454000Z`,
        })),
        rowCount: 11,
      });

      const result = await service.query('tenant-1', { perPage: 10 });
      expect(decodeCursor(result.pagination.next_cursor as string)).toEqual({
        id: '9',
        createdAt: '2026-03-09T12:00:09.454911Z',
      });
    });

    it('setsHasMoreFalseWhenExactPageSize', async () => {
      const { pool, service } = createLogServiceHarness();
      pool.query.mockResolvedValue({
        rows: Array.from({ length: 10 }, (_, index) => ({
          id: String(index),
          created_at: `2026-03-09T12:00:0${index}.000Z`,
        })),
        rowCount: 10,
      });

      const result = await service.query('tenant-1', { perPage: 10 });
      expect(result.pagination.has_more).toBe(false);
      expect(result.data).toHaveLength(10);
      expect(result.pagination.next_cursor).toBeNull();
    });

    it('usesAscOrderWhenRequested', async () => {
      const { pool, service } = createLogServiceHarness();
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await service.query('tenant-1', { order: 'asc' });

      expect(pool.query.mock.calls[0][0]).toContain('ORDER BY l.created_at ASC');
    });

    it('usesAscendingKeysetComparatorWhenCursorAndAscOrderAreRequested', async () => {
      const { pool, service } = createLogServiceHarness();
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await service.query('tenant-1', {
        cursor: encodeCursor('500', '2026-03-09T12:00:00.000Z'),
        order: 'asc',
      });

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('(l.created_at, l.id) >');
      expect(sql).toContain('ORDER BY l.created_at ASC');
      expect(params).toContain('2026-03-09T12:00:00.000Z');
      expect(params).toContain('500');
    });

    it('clampsPerPageToMaximum', async () => {
      const { service } = createLogServiceHarness();
      const result = await service.query('tenant-1', { perPage: 9999 });
      expect(result.pagination.per_page).toBe(500);
    });
  });
});
