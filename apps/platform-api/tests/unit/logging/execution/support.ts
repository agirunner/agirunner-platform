import { vi } from 'vitest';

import { LogService } from '../../../../src/logging/execution/log-service.js';
import type { ExecutionLogEntry } from '../../../../src/logging/execution/log-service.js';

export function createMockPool() {
  return { query: vi.fn().mockResolvedValue({ rowCount: 1, rows: [] }) };
}

export type MockPool = ReturnType<typeof createMockPool>;

export function createLogServiceHarness() {
  const pool = createMockPool();
  return { pool, service: new LogService(pool as never) };
}

export function getInsertCall(pool: MockPool) {
  return pool.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO execution_logs'));
}

export function getPartitionCalls(pool: MockPool) {
  return pool.query.mock.calls.filter(([sql]) =>
    String(sql).includes('create_execution_logs_partition'),
  );
}

export function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function createLogEntry(
  overrides: Partial<ExecutionLogEntry> = {},
): ExecutionLogEntry {
  return {
    tenantId: 'tenant-1',
    traceId: 'trace-1',
    spanId: 'span-1',
    source: 'platform',
    category: 'api',
    level: 'info',
    operation: 'api.default',
    status: 'completed',
    ...overrides,
  };
}

export function createBatchEntries(
  count: number,
  overrides: Partial<ExecutionLogEntry> = {},
): ExecutionLogEntry[] {
  return Array.from({ length: count }, (_, index) =>
    createLogEntry({
      traceId: `trace-${index}`,
      spanId: `span-${index}`,
      ...overrides,
    }),
  );
}
