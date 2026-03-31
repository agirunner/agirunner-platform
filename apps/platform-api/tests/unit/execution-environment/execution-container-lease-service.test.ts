import { describe, expect, it, vi } from 'vitest';

import { ExecutionContainerLeaseService } from '../../../src/services/execution-container-lease-service.js';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

describe('ExecutionContainerLeaseService', () => {
  it('reserves a specialist execution slot when capacity is available', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [{ locked: true }] };
        }
        if (sql.includes('UPDATE execution_container_leases')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM runtime_defaults')) {
          return { rowCount: 1, rows: [{ config_value: '2' }] };
        }
        if (sql.includes('COUNT(*)::int AS total')) {
          return { rowCount: 1, rows: [{ total: 1 }] };
        }
        if (sql.includes('INSERT INTO execution_container_leases')) {
          return {
            rowCount: 1,
            rows: [{ id: 'lease-1' }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const service = new ExecutionContainerLeaseService({ query: vi.fn() } as never);
    const result = await service.reserveForTask(
      TENANT_ID,
      {
        taskId: 'task-1',
        workflowId: 'workflow-1',
        workItemId: 'work-item-1',
        role: 'developer',
        agentId: 'agent-1',
        workerId: 'worker-1',
      },
      client as never,
    );

    expect(result).toEqual({
      reserved: true,
      active: 2,
      limit: 2,
      leaseId: 'lease-1',
    });
  });

  it('returns a backpressure result when the execution cap is full', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [{ locked: true }] };
        }
        if (sql.includes('UPDATE execution_container_leases')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM runtime_defaults')) {
          return { rowCount: 1, rows: [{ config_value: '2' }] };
        }
        if (sql.includes('COUNT(*)::int AS total')) {
          return { rowCount: 1, rows: [{ total: 2 }] };
        }
        if (sql.includes('INSERT INTO execution_container_leases')) {
          throw new Error('insert should not be attempted while full');
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const service = new ExecutionContainerLeaseService({ query: vi.fn() } as never);
    const result = await service.reserveForTask(
      TENANT_ID,
      {
        taskId: 'task-2',
        workflowId: 'workflow-1',
        workItemId: 'work-item-2',
        role: 'developer',
        agentId: 'agent-1',
        workerId: 'worker-1',
      },
      client as never,
    );

    expect(result).toEqual({
      reserved: false,
      active: 2,
      limit: 2,
      leaseId: null,
    });
  });

  it('releases an active execution-container lease for a task', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('UPDATE execution_container_leases')) {
          return { rowCount: 1, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const service = new ExecutionContainerLeaseService({ query: vi.fn() } as never);
    const released = await service.releaseForTask(TENANT_ID, 'task-1', client as never);

    expect(released).toBe(true);
  });
});
