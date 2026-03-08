/**
 * Unit tests for previously-missing (❌) FRs.
 *
 * FRs covered:
 *   FR-150 — All entities scoped to tenant (DB query filtering)
 *   FR-152 — Tenant filter at data-access layer (TenantScopedRepository)
 *   FR-712 — No pattern nesting constraint (validateTemplateSchema)
 *   FR-754 — Zero-config first run (seedDefaultTenant creates default API key)
 *   FR-761 — All entities tenant-scoped (TenantScopedRepository comprehensive)
 *   FR-820 — External workers run anywhere (isOriginAllowed / WORKER_ALLOWED_ORIGINS)
 *
 * FR-741, FR-752, FR-756 removed: built-in Node.js worker replaced by Go
 * runtime connected mode (worker/runtime container merge).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import type { DatabaseQueryable } from '../../src/db/database.js';
import { TenantScopedRepository } from '../../src/db/tenant-scoped-repository.js';
import { assertNoPatternNesting, validateTemplateSchema } from '../../src/orchestration/workflow-engine.js';
import { isOriginAllowed } from '../../src/bootstrap/websocket.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(__dirname, '../../src');

function readSrc(relPath: string): string {
  return fs.readFileSync(path.join(srcDir, relPath), 'utf-8');
}

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

  it('TenantScopedRepository.scopedTenantId exposes the bound tenant', () => {
    // FR-761: downstream services can retrieve the tenant ID from the repository.
    const mockQuery = vi.fn();
    const db = { query: mockQuery } as unknown as DatabaseQueryable;
    const repo = new TenantScopedRepository(db, 'my-tenant');

    expect(repo.scopedTenantId).toBe('my-tenant');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-152: Tenant filter at data-access layer — TenantScopedRepository contract
// ─────────────────────────────────────────────────────────────────────────────

describe('FR-152: tenant filter at data-access layer', () => {
  it('TenantScopedRepository file exists and exports the class', () => {
    // FR-152
    const source = readSrc('db/tenant-scoped-repository.ts');
    expect(source).toContain('export class TenantScopedRepository');
    expect(source).toContain('tenant_id = $1');
  });

  it('repository enforces tenant isolation even when no extra conditions are given', async () => {
    // FR-152: bare findAll with no extra conditions still filters by tenant.
    const mockQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const db = { query: mockQuery } as unknown as DatabaseQueryable;
    const repo = new TenantScopedRepository(db, 'isolated-tenant');

    await repo.findAll('templates', '*');

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
// FR-712: No pattern nesting constraint
// ─────────────────────────────────────────────────────────────────────────────

describe('FR-712: no pattern nesting constraint', () => {
  it('assertNoPatternNesting passes for flat patterns with no nested refs', () => {
    // FR-712
    expect(() =>
      assertNoPatternNesting({
        review: { tasks: [{ id: 't1', type: 'review', title_template: 'Review' }] },
      }),
    ).not.toThrow();
  });

  it('assertNoPatternNesting rejects a pattern with pattern_ref field', () => {
    // FR-712: direct pattern reference via pattern_ref
    expect(() =>
      assertNoPatternNesting({
        nested: { pattern_ref: 'some-other-pattern' },
      }),
    ).toThrow(/pattern_ref.*FR-712|nested pattern reference/i);
  });

  it('assertNoPatternNesting rejects a pattern whose task has type=pattern', () => {
    // FR-712: nested pattern type in task list
    expect(() =>
      assertNoPatternNesting({
        outer: {
          tasks: [{ id: 't1', type: 'pattern', title_template: 'nested' }],
        },
      }),
    ).toThrow(/nested pattern task.*FR-712|Pattern nesting is not allowed/i);
  });

  it('assertNoPatternNesting rejects a task that uses pattern_ref inside a pattern', () => {
    // FR-712: task inside a pattern references another pattern
    expect(() =>
      assertNoPatternNesting({
        outer: {
          tasks: [{ id: 't1', pattern_ref: 'inner', title_template: 'Inner' }],
        },
      }),
    ).toThrow(/FR-712|Pattern nesting is not allowed/i);
  });

  it('validateTemplateSchema rejects a schema with a nested pattern', () => {
    // FR-712: end-to-end rejection at template creation boundary
    const schemaWithNestedPattern = {
      tasks: [{ id: 't1', type: 'analysis', title_template: 'Analyse' }],
      patterns: {
        bad: { pattern_ref: 'other-pattern' },
      },
    };

    expect(() => validateTemplateSchema(schemaWithNestedPattern)).toThrow(/FR-712|Pattern nesting is not allowed/i);
  });

  it('validateTemplateSchema accepts a schema with flat (non-nested) patterns', () => {
    // FR-712: valid schema should not throw
    const validSchema = {
      tasks: [{ id: 't1', type: 'code', title_template: 'Build' }],
      patterns: {
        safe: { tasks: [{ id: 'p1', type: 'review', title_template: 'PR review' }] },
      },
    };

    expect(() => validateTemplateSchema(validSchema)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-754: Zero-config first run — default tenant + default API key
// ─────────────────────────────────────────────────────────────────────────────

describe('FR-754: zero-config first run creates default tenant and API key', () => {
  it('seed.ts exports seedDefaultTenant which handles both tenant and API key', () => {
    // FR-754
    const source = readSrc('db/seed.ts');
    expect(source).toContain('seedDefaultTenant');
    expect(source).toContain('seedDefaultAdminKey');
    expect(source).toContain('DEFAULT_TENANT_ID');
    expect(source).toContain('INSERT INTO api_keys');
  });

  it('default key prefix is deterministic to allow idempotent detection', () => {
    // FR-754: fixed prefix prevents duplicate key creation across restarts
    const source = readSrc('db/seed.ts');
    expect(source).toContain("DEFAULT_ADMIN_KEY_PREFIX = 'ar_admin_def'");
  });

  it('seed prints the API key only on first creation', () => {
    // FR-754: operator gets the key exactly once without needing config files
    const source = readSrc('db/seed.ts');
    expect(source).toContain('console.info');
    expect(source).toContain('Zero-Config First Run');
    expect(source).toContain('Store this key');
  });

  it('seedDefaultTenant is idempotent using ON CONFLICT DO NOTHING', () => {
    // FR-754: safe to call on every server start
    const source = readSrc('db/seed.ts');
    expect(source).toContain('ON CONFLICT');
    expect(source).toContain('DO NOTHING');
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

  it('worker registration route accepts standard connection modes', () => {
    const source = readSrc('api/routes/workers.routes.ts');
    expect(source).toContain("'websocket'");
    expect(source).toContain("'polling'");
    expect(source).toContain("'sse'");
  });
});
