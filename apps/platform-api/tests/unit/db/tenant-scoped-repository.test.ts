import { describe, expect, it, vi } from 'vitest';

import type { DatabaseQueryable } from '../../../src/db/database.js';
import { TenantScopedRepository } from '../../../src/db/tenant-scoped-repository.js';

describe('TenantScopedRepository', () => {
  it('prepends tenant_id when listing with extra conditions', async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const db = { query: mockQuery } as unknown as DatabaseQueryable;
    const repo = new TenantScopedRepository(db, 'tenant-abc');

    await repo.findAll('tasks', 'id, state', ['state = $2'], ['ready']);

    const [sql, values] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('tenant_id = $1');
    expect(values[0]).toBe('tenant-abc');
  });

  it('prepends tenant_id when finding by id', async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const db = { query: mockQuery } as unknown as DatabaseQueryable;
    const repo = new TenantScopedRepository(db, 'tenant-xyz');

    await repo.findById('workflows', 'id, status', 'workflow-1');

    const [sql, values] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('tenant_id = $1');
    expect(values[0]).toBe('tenant-xyz');
    expect(values[1]).toBe('workflow-1');
  });

  it('prepends tenant filters before count conditions', async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rows: [{ total: '5' }], rowCount: 1 });
    const db = { query: mockQuery } as unknown as DatabaseQueryable;
    const repo = new TenantScopedRepository(db, 'tenant-count');

    const total = await repo.count('agents', ['status = $2'], ['idle']);

    expect(total).toBe(5);
    const [sql, values] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('tenant_id = $1');
    expect(values[0]).toBe('tenant-count');
    expect(values[1]).toBe('idle');
  });

  it('returns false from exists when the scoped count is zero', async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rows: [{ total: '0' }], rowCount: 1 });
    const db = { query: mockQuery } as unknown as DatabaseQueryable;
    const repo = new TenantScopedRepository(db, 'tenant-empty');

    await expect(repo.exists('workers')).resolves.toBe(false);
  });

  it('enforces tenant isolation even without extra conditions', async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const db = { query: mockQuery } as unknown as DatabaseQueryable;
    const repo = new TenantScopedRepository(db, 'isolated-tenant');

    await repo.findAll('playbooks', '*');

    const [sql, values] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/WHERE tenant_id = \$1/);
    expect(values).toEqual(['isolated-tenant']);
  });

  it('keeps tenant bind values scoped per repository instance', async () => {
    const mockQueryA = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const mockQueryB = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const repoA = new TenantScopedRepository(
      { query: mockQueryA } as unknown as DatabaseQueryable,
      'tenant-A',
    );
    const repoB = new TenantScopedRepository(
      { query: mockQueryB } as unknown as DatabaseQueryable,
      'tenant-B',
    );

    await repoA.findAll('tasks', 'id');
    await repoB.findAll('tasks', 'id');

    const [, valuesA] = mockQueryA.mock.calls[0] as [string, unknown[]];
    const [, valuesB] = mockQueryB.mock.calls[0] as [string, unknown[]];
    expect(valuesA[0]).toBe('tenant-A');
    expect(valuesB[0]).toBe('tenant-B');
  });
});
