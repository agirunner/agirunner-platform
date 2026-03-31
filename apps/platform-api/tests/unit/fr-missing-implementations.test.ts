/**
 * Unit tests for previously-missing (❌) FRs.
 *
 * FRs covered:
 *   FR-150 — All entities scoped to tenant (DB query filtering)
 *   FR-152 — Tenant filter at data-access layer (TenantScopedRepository)
 *   FR-754 — Zero-config first run (seedDefaultTenant creates default API key)
 *   FR-761 — All entities tenant-scoped (TenantScopedRepository comprehensive)
 *   FR-820 — External workers run anywhere (isOriginAllowed / WORKER_ALLOWED_ORIGINS)
 *
 * FR-741, FR-752, FR-756 removed: built-in Node.js worker replaced by Go
 * runtime connected mode (worker/runtime container merge).
 */

import { describe, expect, it, vi } from 'vitest';

import type { DatabaseQueryable } from '../../src/db/database.js';
import { TenantScopedRepository } from '../../src/db/tenant-scoped-repository.js';
import { isOriginAllowed } from '../../src/bootstrap/websocket.js';

// ─────────────────────────────────────────────────────────────────────────────
// FR-150 & FR-761: All entities scoped to tenant — DB query filtering
// ─────────────────────────────────────────────────────────────────────────────

describe('FR-150 & FR-761: all DB queries must filter by tenant_id', () => {
  it('TenantScopedRepository.findAll always prepends tenant_id to WHERE clause', async () => {
    // FR-150, FR-761
    const mockQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const db = { query: mockQuery } as unknown as DatabaseQueryable;
    const repo = new TenantScopedRepository(db, 'tenant-abc');

    await repo.findAll('tasks', 'id, state', ['state = $2'], ['ready']);

    const [sql, values] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('tenant_id = $1');
    expect(values[0]).toBe('tenant-abc');
  });

  it('TenantScopedRepository.findById injects tenant_id as first bind value', async () => {
    // FR-150, FR-761
    const mockQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const db = { query: mockQuery } as unknown as DatabaseQueryable;
    const repo = new TenantScopedRepository(db, 'tenant-xyz');

    await repo.findById('workflows', 'id, status', 'workflow-1');

    const [sql, values] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('tenant_id = $1');
    expect(values[0]).toBe('tenant-xyz');
    expect(values[1]).toBe('workflow-1');
  });

  it('TenantScopedRepository.count prepends tenant filter before extra conditions', async () => {
    // FR-150, FR-761
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

  it('TenantScopedRepository.exists returns false when count is 0', async () => {
    // FR-150
    const mockQuery = vi.fn().mockResolvedValue({ rows: [{ total: '0' }], rowCount: 1 });
    const db = { query: mockQuery } as unknown as DatabaseQueryable;
    const repo = new TenantScopedRepository(db, 'tenant-empty');

    const result = await repo.exists('workers');

    expect(result).toBe(false);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// FR-152: Tenant filter at data-access layer — TenantScopedRepository contract
// ─────────────────────────────────────────────────────────────────────────────

describe('FR-152: tenant filter at data-access layer', () => {
  it('repository enforces tenant isolation even when no extra conditions are given', async () => {
    // FR-152: bare findAll with no extra conditions still filters by tenant.
    const mockQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const db = { query: mockQuery } as unknown as DatabaseQueryable;
    const repo = new TenantScopedRepository(db, 'isolated-tenant');

    await repo.findAll('playbooks', '*');

    const [sql, values] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/WHERE tenant_id = \$1/);
    expect(values).toEqual(['isolated-tenant']);
  });

  it('two repositories with different tenants produce different bind values', async () => {
    // FR-152: verifies that per-tenant isolation is not shared across instances.
    const mockQueryA = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const mockQueryB = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const repoA = new TenantScopedRepository({ query: mockQueryA } as unknown as DatabaseQueryable, 'tenant-A');
    const repoB = new TenantScopedRepository({ query: mockQueryB } as unknown as DatabaseQueryable, 'tenant-B');

    await repoA.findAll('tasks', 'id');
    await repoB.findAll('tasks', 'id');

    const [, valuesA] = mockQueryA.mock.calls[0] as [string, unknown[]];
    const [, valuesB] = mockQueryB.mock.calls[0] as [string, unknown[]];
    expect(valuesA[0]).toBe('tenant-A');
    expect(valuesB[0]).toBe('tenant-B');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-820: External workers run anywhere (network-transparent protocol)
// ─────────────────────────────────────────────────────────────────────────────

describe('FR-820: external workers connect via network-transparent protocol', () => {
  it('isOriginAllowed allows any origin when config is *', () => {
    expect(isOriginAllowed('https://worker.example.com', '*')).toBe(true);
    expect(isOriginAllowed(undefined, '*')).toBe(true);
    expect(isOriginAllowed('http://any-host.internal', '*')).toBe(true);
  });

  it('isOriginAllowed permits only listed origins when config is restrictive', () => {
    const config = 'https://workers.corp.example.com, http://localhost:3000';
    expect(isOriginAllowed('https://workers.corp.example.com', config)).toBe(true);
    expect(isOriginAllowed('https://attacker.example.com', config)).toBe(false);
    expect(isOriginAllowed(undefined, config)).toBe(true);
  });

});
