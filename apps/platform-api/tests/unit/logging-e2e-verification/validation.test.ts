import { describe, expect, it } from 'vitest';

import { LogService } from '../../../src/logging/log-service.js';
import { createMockPool } from './support.js';

describe('Logging E2E Verification - validation', () => {
  it('dropsEntriesBelowTenantThreshold', async () => {
    const pool = createMockPool();
    const service = new LogService(pool as never);
    service.setLevelFilter({
      shouldWrite: async (_tenantId: string, level: string) => level !== 'debug',
    });

    await service.insert({
      tenantId: 'tenant-1',
      traceId: 'trace-1',
      spanId: 'span-1',
      source: 'runtime',
      category: 'llm',
      level: 'debug',
      operation: 'llm.token_count',
      status: 'completed',
    });

    expect(pool.rows).toHaveLength(0);
  });

  it('allowsEntriesAtOrAboveThreshold', async () => {
    const pool = createMockPool();
    const service = new LogService(pool as never);
    service.setLevelFilter({
      shouldWrite: async (_tenantId: string, level: string) => level !== 'debug',
    });

    await service.insert({
      tenantId: 'tenant-1',
      traceId: 'trace-1',
      spanId: 'span-1',
      source: 'runtime',
      category: 'llm',
      level: 'warn',
      operation: 'llm.rate_limit',
      status: 'completed',
    });

    expect(pool.rows).toHaveLength(1);
  });

  it('storesProvidedWorkflowNameWithoutDbLookup', async () => {
    const pool = createMockPool();
    const service = new LogService(pool as never);

    await service.insert({
      tenantId: 'tenant-1',
      traceId: 'trace-1',
      spanId: 'span-1',
      source: 'runtime',
      category: 'task_lifecycle',
      level: 'info',
      operation: 'task.started',
      status: 'started',
      workflowId: 'wf-1',
      workflowName: 'Build Pipeline',
      workspaceId: 'proj-1',
      workspaceName: 'My Workspace',
    });

    expect(pool.rows).toHaveLength(1);
    expect(pool.rows[0].workflow_name).toBe('Build Pipeline');
    expect(pool.rows[0].workspace_name).toBe('My Workspace');
  });

  it('storesNullWhenNamesNotProvided', async () => {
    const pool = createMockPool();
    const service = new LogService(pool as never);

    await service.insert({
      tenantId: 'tenant-1',
      traceId: 'trace-1',
      spanId: 'span-1',
      source: 'runtime',
      category: 'task_lifecycle',
      level: 'info',
      operation: 'task.started',
      status: 'started',
      workflowId: 'wf-1',
    });

    expect(pool.rows).toHaveLength(1);
    expect(pool.rows[0].workflow_name).toBeNull();
    expect(pool.rows[0].workspace_name).toBeNull();
  });

  it('acceptsAllValidSources', async () => {
    const pool = createMockPool();
    const service = new LogService(pool as never);

    for (const source of [
      'runtime',
      'container_manager',
      'platform',
      'task_container',
    ] as const) {
      await service.insert({
        tenantId: 'tenant-1',
        traceId: 'trace-1',
        spanId: 'span-1',
        source,
        category: 'api',
        level: 'info',
        operation: `test.${source}`,
        status: 'completed',
      });
    }

    expect(pool.rows).toHaveLength(4);
    expect(pool.rows.map((r) => r.source)).toEqual([
      'runtime',
      'container_manager',
      'platform',
      'task_container',
    ]);
  });

  it('acceptsAllValidCategories', async () => {
    const pool = createMockPool();
    const service = new LogService(pool as never);
    const categories = [
      'llm',
      'tool',
      'agent_loop',
      'task_lifecycle',
      'runtime_lifecycle',
      'container',
      'api',
      'config',
      'auth',
    ] as const;

    for (const category of categories) {
      await service.insert({
        tenantId: 'tenant-1',
        traceId: 'trace-1',
        spanId: 'span-1',
        source: 'platform',
        category,
        level: 'info',
        operation: `test.${category}`,
        status: 'completed',
      });
    }

    expect(pool.rows).toHaveLength(9);
  });
});
