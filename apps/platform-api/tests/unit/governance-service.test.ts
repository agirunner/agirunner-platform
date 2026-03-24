import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GovernanceService } from '../../src/services/governance-service.js';

function createMockPool() {
  return {
    query: vi.fn(),
  };
}

describe('GovernanceService retention policies', () => {
  let pool: ReturnType<typeof createMockPool>;
  let service: GovernanceService;

  beforeEach(() => {
    pool = createMockPool();
    service = new GovernanceService(
      pool as never,
      {
        GOVERNANCE_TASK_PRUNE_AFTER_DAYS: 30,
        GOVERNANCE_WORKFLOW_DELETE_AFTER_DAYS: 30,
        GOVERNANCE_EXECUTION_LOG_RETENTION_DAYS: 30,
      } as never,
    );
  });

  it('prunes terminal tasks only from ongoing workflows and deletes terminal workflows after retention', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'tenant-1',
            settings: {
              governance: {
                retention: {
                  task_prune_after_days: 30,
                  workflow_delete_after_days: 30,
                  execution_log_retention_days: 60,
                },
              },
            },
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'task-1' }, { id: 'task-2' }],
        rowCount: 2,
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'workflow-1' }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{ dropped: 2 }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rowCount: 0 });

    const result = await service.enforceRetentionPolicies();

    expect(result).toEqual({
      prunedTasks: 2,
      deletedWorkflows: 1,
      droppedLogPartitions: 2,
    });

    expect(pool.query).toHaveBeenNthCalledWith(2, expect.stringContaining('DELETE FROM tasks t'), [
      'tenant-1',
      ['completed', 'failed', 'cancelled'],
      ['completed', 'failed', 'cancelled'],
      30,
    ]);
    expect(pool.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('DELETE FROM workflows w'),
      ['tenant-1', ['completed', 'failed', 'cancelled'], 30],
    );
  });

  it('reads the new retention policy fields from tenant settings', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'tenant-1',
          settings: {
            governance: {
              retention: {
                task_prune_after_days: 14,
                workflow_delete_after_days: 45,
                execution_log_retention_days: 90,
              },
            },
          },
        },
      ],
      rowCount: 1,
    });

    const result = await service.getRetentionPolicy('tenant-1');

    expect(result).toEqual({
      task_prune_after_days: 14,
      workflow_delete_after_days: 45,
      execution_log_retention_days: 90,
    });
  });

  it('creates the governance object when saving retention into empty tenant settings', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [{ id: 'tenant-1', settings: {} }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    await service.updateRetentionPolicy(
      {
        tenantId: 'tenant-1',
      } as never,
      {
        task_prune_after_days: 21,
      },
    );

    const updateQuery = pool.query.mock.calls[1]?.[0] as string;
    expect(updateQuery).toContain("'{governance}'");
    expect(updateQuery).toContain("'{retention}'");
    expect(updateQuery).not.toContain("'{governance,retention}'");
  });

  it('creates the logging object when saving logging level into empty tenant settings', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    await service.setLoggingLevel(
      {
        tenantId: 'tenant-1',
      } as never,
      'warn',
    );

    const updateQuery = pool.query.mock.calls[0]?.[0] as string;
    expect(updateQuery).toContain("'{logging}'");
    expect(updateQuery).toContain("'{level}'");
    expect(updateQuery).not.toContain("'{logging,level}'");
  });
});
