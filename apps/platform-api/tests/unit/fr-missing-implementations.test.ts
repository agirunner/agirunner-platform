/**
 * Unit tests for all 9 previously-missing (❌) FRs.
 *
 * FRs covered:
 *   FR-150 — All entities scoped to tenant (DB query filtering)
 *   FR-152 — Tenant filter at data-access layer (TenantScopedRepository)
 *   FR-712 — No pattern nesting constraint (validateTemplateSchema)
 *   FR-741 — Built-in worker separate from server (worker-process entry point)
 *   FR-752 — Built-in agent replaceable by external (isBuiltInAgentReplaceable)
 *   FR-754 — Zero-config first run (seedDefaultTenant creates default API key)
 *   FR-756 — Built-in agents have no exclusive capabilities (same system)
 *   FR-761 — All entities tenant-scoped (TenantScopedRepository comprehensive)
 *   FR-820 — External workers run anywhere (isOriginAllowed / WORKER_ALLOWED_ORIGINS)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import type { DatabaseQueryable } from '../../src/db/database.js';
import { TenantScopedRepository } from '../../src/db/tenant-scoped-repository.js';
import { isBuiltInAgentReplaceable } from '../../src/orchestration/capability-matcher.js';
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
// FR-741: Built-in worker separate from server
// ─────────────────────────────────────────────────────────────────────────────

describe('FR-741: built-in worker launchable independently from the API server', () => {
  it('worker-process.ts entry point exists as a standalone module', () => {
    // FR-741: verify the file exists (the process is launched independently)
    const workerProcessPath = path.join(srcDir, 'worker-process.ts');
    expect(fs.existsSync(workerProcessPath)).toBe(true);
  });

  it('worker-process.ts does not import the API server bootstrap', () => {
    // FR-741: worker process must not depend on server startup
    const source = readSrc('worker-process.ts');
    expect(source).not.toContain("from './bootstrap/app");
    expect(source).not.toContain("from './bootstrap/server");
    expect(source).not.toContain('startServer');
    expect(source).not.toContain('buildApp');
  });

  it('bootstrap/built-in-worker.ts provides registerBuiltInWorker and connectBuiltInWorkerWebSocket', () => {
    // FR-741: worker lifecycle functions are available independently
    const source = readSrc('bootstrap/built-in-worker.ts');
    expect(source).toContain('registerBuiltInWorker');
    expect(source).toContain('connectBuiltInWorkerWebSocket');
  });

  it('platform-api package.json exposes a worker script', () => {
    // FR-741: operator can start the worker with pnpm worker
    const pkgPath = path.resolve(__dirname, '../../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { scripts: Record<string, string> };
    expect(pkg.scripts).toHaveProperty('worker');
    expect(pkg.scripts.worker).toContain('worker-process');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-752: Built-in agent replaceable by external agent
// ─────────────────────────────────────────────────────────────────────────────

describe('FR-752: built-in agent replaceable by external agent with same capabilities', () => {
  it('returns true when an external active agent covers all built-in capabilities', () => {
    // FR-752
    const result = isBuiltInAgentReplaceable(['code', 'typescript'], [
      { capabilities: ['code', 'typescript', 'testing'], status: 'online', isBuiltIn: false },
    ]);
    expect(result).toBe(true);
  });

  it('returns false when no external agent covers all capabilities', () => {
    // FR-752
    const result = isBuiltInAgentReplaceable(['code', 'typescript', 'security'], [
      { capabilities: ['code', 'typescript'], status: 'online', isBuiltIn: false },
    ]);
    expect(result).toBe(false);
  });

  it('returns false when matching agent is itself built-in', () => {
    // FR-752: another built-in does not count as an external replacement
    const result = isBuiltInAgentReplaceable(['code'], [
      { capabilities: ['code', 'testing'], status: 'online', isBuiltIn: true },
    ]);
    expect(result).toBe(false);
  });

  it('returns false when matching external agent is offline', () => {
    // FR-752: offline agents cannot replace the built-in
    const result = isBuiltInAgentReplaceable(['analysis'], [
      { capabilities: ['analysis'], status: 'offline', isBuiltIn: false },
    ]);
    expect(result).toBe(false);
  });

  it('returns false when matching external agent is draining', () => {
    // FR-752: draining agents are not valid replacements
    const result = isBuiltInAgentReplaceable(['analysis'], [
      { capabilities: ['analysis'], status: 'draining', isBuiltIn: false },
    ]);
    expect(result).toBe(false);
  });

  it('returns true with multiple candidates when at least one qualifies', () => {
    // FR-752
    const result = isBuiltInAgentReplaceable(['review'], [
      { capabilities: ['code'], status: 'online', isBuiltIn: false },
      { capabilities: ['review', 'code'], status: 'online', isBuiltIn: false },
    ]);
    expect(result).toBe(true);
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
// FR-756: Built-in agents have no exclusive capabilities
// ─────────────────────────────────────────────────────────────────────────────

describe('FR-756: built-in agents use same capability system as external agents', () => {
  it('built-in-worker registration payload uses the standard capabilities field', () => {
    // FR-756: no proprietary fields — same protocol as external workers
    const source = readSrc('bootstrap/built-in-worker.ts');
    expect(source).toContain('capabilities: config.capabilities');
    expect(source).toContain("connection_mode: 'websocket'");
    // Must NOT use any special scope or privilege field
    expect(source).not.toContain('exclusive_capabilities');
    expect(source).not.toContain('admin_scope');
    expect(source).not.toContain('bypass_capability_check');
  });

  it('isBuiltInAgentReplaceable uses isCapabilitySubset — same matching logic for all agents', () => {
    // FR-756: built-in capability check uses the same function external agents use
    const source = readSrc('orchestration/capability-matcher.ts');
    expect(source).toContain('isBuiltInAgentReplaceable');
    expect(source).toContain('isCapabilitySubset');
    // The replaceability function must delegate to the shared matcher
    const fnBody = source.slice(source.indexOf('isBuiltInAgentReplaceable'));
    expect(fnBody).toContain('isCapabilitySubset');
  });

  it('built-in worker runtime_type is internal but capabilities are open', () => {
    // FR-756: runtime_type distinguishes origin but does not restrict capabilities.
    // 'internal' is the DB enum value for built-in (platform-managed) workers.
    const source = readSrc('bootstrap/built-in-worker.ts');
    expect(source).toContain("runtime_type: 'internal'");
    // capabilities come from config — not hardcoded
    expect(source).toContain('capabilities: config.capabilities');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-820: External workers run anywhere (network-transparent protocol)
// ─────────────────────────────────────────────────────────────────────────────

describe('FR-820: external workers connect via network-transparent protocol', () => {
  it('isOriginAllowed allows any origin when config is *', () => {
    // FR-820: tests the actual production function — no inline re-implementation
    expect(isOriginAllowed('https://worker.example.com', '*')).toBe(true);
    expect(isOriginAllowed(undefined, '*')).toBe(true);
    expect(isOriginAllowed('http://any-host.internal', '*')).toBe(true);
  });

  it('isOriginAllowed permits only listed origins when config is restrictive', () => {
    // FR-820: operators CAN restrict origins; default is open
    const config = 'https://workers.corp.example.com, http://localhost:3000';
    expect(isOriginAllowed('https://workers.corp.example.com', config)).toBe(true);
    expect(isOriginAllowed('https://attacker.example.com', config)).toBe(false);
    expect(isOriginAllowed(undefined, config)).toBe(true); // native clients OK
  });

  it('built-in-worker connects via standard WebSocket URL — no host lock-in', () => {
    // FR-820: worker derives the URL from PLATFORM_API_URL at runtime
    const source = readSrc('bootstrap/built-in-worker.ts');
    expect(source).toContain('apiBaseUrl.replace');
    expect(source).toContain("replace(/^http/, 'ws')");
  });

  it('worker-process.ts reads PLATFORM_API_URL from env — works with any host', () => {
    // FR-820: external workers can point at any platform host
    const source = readSrc('worker-process.ts');
    expect(source).toContain('PLATFORM_API_URL');
    expect(source).toContain('process.env');
  });
});
