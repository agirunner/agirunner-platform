import { describe, expect, it, vi } from 'vitest';

import { DestructiveDeleteService } from '../../../src/services/destructive-delete/destructive-delete-service.js';

describe('DestructiveDeleteService', () => {
  it('cancels active selected workflows and purges them in one permanent bulk delete', async () => {
    const client = createBulkWorkflowDeleteClient();
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        assertSequentialParameters(sql);
        if (sql.includes('FROM workflows') && sql.includes('id = ANY($2::uuid[])') && sql.includes('state::text = ANY')) {
          expect(params).toEqual(['tenant-1', ['workflow-active', 'workflow-terminal'], ['active', 'paused']]);
          return { rowCount: 1, rows: [{ id: 'workflow-active' }] };
        }
        throw new Error(`unexpected pool query: ${sql} :: ${JSON.stringify(params ?? [])}`);
      }),
      connect: vi.fn().mockResolvedValue(client),
    };
    const cancelWorkflow = vi.fn().mockResolvedValue(undefined);
    const service = new DestructiveDeleteService(pool as never, { cancelWorkflow });

    await expect(
      service.deleteWorkflowsPermanently(createIdentity(), ['workflow-active', 'workflow-terminal', 'workflow-active']),
    ).resolves.toEqual({
      deleted: true,
      deleted_workflow_count: 2,
      deleted_task_count: 2,
      deleted_workflow_ids: ['workflow-active', 'workflow-terminal'],
    });

    expect(cancelWorkflow).toHaveBeenCalledTimes(1);
    expect(cancelWorkflow).toHaveBeenCalledWith(createIdentity(), 'workflow-active');
    expect(client.release).toHaveBeenCalled();
  });

  it('deletes a playbook family without non-sequential SQL parameters in purge cleanup', async () => {
    const client = createStrictTransactionalClient();
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        assertSequentialParameters(sql);
        if (sql.includes('FROM playbooks') && sql.includes('AND id = $2')) {
          return { rowCount: 1, rows: [{ id: 'playbook-1', slug: 'family-slug' }] };
        }
        if (sql.includes('FROM playbooks') && sql.includes('AND slug = $2')) {
          return { rowCount: 2, rows: [{ id: 'playbook-1' }, { id: 'playbook-2' }] };
        }
        if (sql.includes('FROM workflows') && sql.includes('playbook_id = ANY($2::uuid[])')) {
          return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
        }
        throw new Error(`unexpected pool query: ${sql} :: ${JSON.stringify(params ?? [])}`);
      }),
      connect: vi.fn().mockResolvedValue(client),
    };
    const cancelWorkflow = vi.fn().mockResolvedValue(undefined);
    const service = new DestructiveDeleteService(pool as never, { cancelWorkflow });

    await expect(
      service.deletePlaybookPermanently(createIdentity(), 'playbook-1'),
    ).resolves.toEqual({
      id: 'playbook-1',
      deleted: true,
      deleted_revision_count: 2,
      deleted_workflow_count: 1,
      deleted_task_count: 1,
    });

    expect(cancelWorkflow).toHaveBeenCalledWith(createIdentity(), 'workflow-1');
    expect(client.release).toHaveBeenCalled();
  });

  it('deletes a workspace cascade without non-sequential SQL parameters in purge cleanup', async () => {
    const client = createStrictTransactionalClient();
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        assertSequentialParameters(sql);
        if (sql.includes('FROM workspaces') && sql.includes('AND id = $2')) {
          return { rowCount: 1, rows: [{ id: 'workspace-1' }] };
        }
        if (sql.includes('FROM workflows') && sql.includes('workspace_id = $2') && sql.includes('state::text = ANY')) {
          return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
        }
        if (sql.includes('FROM tasks') && sql.includes('workspace_id = $2') && sql.includes('workflow_id IS NULL')) {
          return { rowCount: 1, rows: [{ id: 'task-standalone-1' }] };
        }
        throw new Error(`unexpected pool query: ${sql} :: ${JSON.stringify(params ?? [])}`);
      }),
      connect: vi.fn().mockResolvedValue(client),
    };
    const cancelWorkflow = vi.fn().mockResolvedValue(undefined);
    const cancelTask = vi.fn().mockResolvedValue(undefined);
    const artifactStorage = {
      deleteObject: vi.fn().mockResolvedValue(undefined),
    };
    const service = new DestructiveDeleteService(pool as never, {
      cancelWorkflow,
      cancelTask,
      artifactStorage,
    });

    await expect(
      service.deleteWorkspaceCascading(createIdentity(), 'workspace-1'),
    ).resolves.toEqual({
      id: 'workspace-1',
      deleted: true,
      deleted_workflow_count: 1,
      deleted_task_count: 3,
    });

    expect(cancelWorkflow).toHaveBeenCalledWith(createIdentity(), 'workflow-1');
    expect(cancelTask).toHaveBeenCalledWith(createIdentity(), 'task-standalone-1');
    expect(artifactStorage.deleteObject).toHaveBeenCalledTimes(3);
    expect(artifactStorage.deleteObject).toHaveBeenNthCalledWith(
      1,
      'tenant-1/workflow-1/artifact-1/report.md',
    );
    expect(artifactStorage.deleteObject).toHaveBeenNthCalledWith(
      2,
      'tenant-1/task-standalone-1/artifact-2/log.txt',
    );
    expect(artifactStorage.deleteObject).toHaveBeenNthCalledWith(
      3,
      'tenant-1/workspace-1/workspace-file-1/brief.md',
    );
    expect(client.release).toHaveBeenCalled();
  });

  it('skips workflow cancellation when the workspace only contains non-cancellable workflow states', async () => {
    const client = createStrictTransactionalClient();
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        assertSequentialParameters(sql);
        if (sql.includes('FROM workspaces') && sql.includes('AND id = $2')) {
          return { rowCount: 1, rows: [{ id: 'workspace-1' }] };
        }
        if (sql.includes('FROM workflows') && sql.includes('workspace_id = $2') && sql.includes('state::text = ANY')) {
          expect(params?.[2]).toEqual(['active', 'paused']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM tasks') && sql.includes('workspace_id = $2') && sql.includes('workflow_id IS NULL')) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected pool query: ${sql} :: ${JSON.stringify(params ?? [])}`);
      }),
      connect: vi.fn().mockResolvedValue(client),
    };
    const cancelWorkflow = vi.fn().mockResolvedValue(undefined);
    const service = new DestructiveDeleteService(pool as never, { cancelWorkflow });

    await expect(
      service.deleteWorkspaceCascading(createIdentity(), 'workspace-1'),
    ).resolves.toEqual({
      id: 'workspace-1',
      deleted: true,
      deleted_workflow_count: 1,
      deleted_task_count: 3,
    });

    expect(cancelWorkflow).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalled();
  });

  it('tolerates workflows that become terminal during cascading workspace deletion', async () => {
    const client = createStrictTransactionalClient();
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        assertSequentialParameters(sql);
        if (sql.includes('FROM workspaces') && sql.includes('AND id = $2')) {
          return { rowCount: 1, rows: [{ id: 'workspace-1' }] };
        }
        if (sql.includes('FROM workflows') && sql.includes('workspace_id = $2') && sql.includes('state::text = ANY')) {
          return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
        }
        if (sql.includes('FROM tasks') && sql.includes('workspace_id = $2') && sql.includes('workflow_id IS NULL')) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected pool query: ${sql} :: ${JSON.stringify(params ?? [])}`);
      }),
      connect: vi.fn().mockResolvedValue(client),
    };
    const cancelWorkflow = vi
      .fn()
      .mockRejectedValueOnce(new Error('Workflow is already terminal'));
    const service = new DestructiveDeleteService(pool as never, { cancelWorkflow });

    await expect(
      service.deleteWorkspaceCascading(createIdentity(), 'workspace-1'),
    ).resolves.toEqual({
      id: 'workspace-1',
      deleted: true,
      deleted_workflow_count: 1,
      deleted_task_count: 3,
    });

    expect(cancelWorkflow).toHaveBeenCalledWith(createIdentity(), 'workflow-1');
    expect(client.release).toHaveBeenCalled();
  });

  it('purges residual workspace-scoped tasks before deleting the workspace row', async () => {
    const client = createStrictTransactionalClient();
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        assertSequentialParameters(sql);
        if (sql.includes('FROM workspaces') && sql.includes('AND id = $2')) {
          return { rowCount: 1, rows: [{ id: 'workspace-1' }] };
        }
        if (sql.includes('FROM workflows') && sql.includes('workspace_id = $2') && sql.includes('state::text = ANY')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM tasks') && sql.includes('workspace_id = $2') && sql.includes('workflow_id IS NULL')) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected pool query: ${sql} :: ${JSON.stringify(params ?? [])}`);
      }),
      connect: vi.fn().mockResolvedValue(client),
    };
    const service = new DestructiveDeleteService(pool as never);

    await expect(
      service.deleteWorkspaceCascading(createIdentity(), 'workspace-1'),
    ).resolves.toEqual({
      id: 'workspace-1',
      deleted: true,
      deleted_workflow_count: 1,
      deleted_task_count: 3,
    });

    const workspaceScopedDeleteCall = client.query.mock.calls.find(
      ([sql, params]) =>
        typeof sql === 'string'
        && sql.includes('DELETE FROM tasks')
        && sql.includes('workspace_id = $2')
        && Array.isArray(params)
        && params[1] === 'workspace-1',
    );
    expect(workspaceScopedDeleteCall).toBeDefined();

    const deleteWorkspaceCallIndex = client.query.mock.calls.findIndex(
      ([sql]) => typeof sql === 'string' && sql.startsWith('DELETE FROM workspaces'),
    );
    const deleteWorkspaceTaskCallIndexes = client.query.mock.calls
      .map(([sql, params], index) =>
        typeof sql === 'string'
        && sql.includes('DELETE FROM tasks')
        && sql.includes('workspace_id = $2')
        && Array.isArray(params)
        && params[1] === 'workspace-1'
          ? index
          : -1,
      )
      .filter((index) => index >= 0);
    expect(deleteWorkspaceTaskCallIndexes.length).toBe(2);
    expect(deleteWorkspaceTaskCallIndexes.at(-1) ?? -1).toBeLessThan(deleteWorkspaceCallIndex);

    const workflowScopedTaskDeleteCall = client.query.mock.calls.find(
      ([sql]) =>
        typeof sql === 'string'
        && sql.includes('DELETE FROM tasks')
        && sql.includes('workflow_id = ANY($2::uuid[])'),
    );
    expect(workflowScopedTaskDeleteCall).toBeDefined();
  });
});

function createStrictTransactionalClient() {
  let residualWorkspaceTaskDeleteCount = 0;
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rowCount: 0, rows: [] };
      }

      assertSequentialParameters(sql);

      if (sql.includes('SELECT id') && sql.includes('FROM workflows') && sql.includes('playbook_id = ANY($2::uuid[])')) {
        return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
      }
      if (sql.includes('SELECT id') && sql.includes('FROM tasks') && sql.includes('workflow_id = ANY($2::uuid[])')) {
        return { rowCount: 1, rows: [{ id: 'task-1' }] };
      }
      if (sql.includes('SELECT id') && sql.includes('FROM workflows') && sql.includes('workspace_id = $2')) {
        return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
      }
      if (sql.includes('SELECT id') && sql.includes('FROM tasks') && sql.includes('workspace_id = $2')) {
        return { rowCount: 2, rows: [{ id: 'task-1' }, { id: 'task-standalone-1' }] };
      }
      if (sql.includes('SELECT DISTINCT storage_key') && sql.includes('FROM workflow_artifacts')) {
        return {
          rowCount: 2,
          rows: [
            { storage_key: 'tenant-1/workflow-1/artifact-1/report.md' },
            { storage_key: 'tenant-1/task-standalone-1/artifact-2/log.txt' },
          ],
        };
      }
      if (sql.includes('SELECT DISTINCT storage_key') && sql.includes('FROM workspace_artifact_files')) {
        return {
          rowCount: 1,
          rows: [{ storage_key: 'tenant-1/workspace-1/workspace-file-1/brief.md' }],
        };
      }
      if (sql.startsWith('DELETE FROM tasks')) {
        if (sql.includes('workspace_id = $2')) {
          residualWorkspaceTaskDeleteCount += 1;
          return residualWorkspaceTaskDeleteCount === 1
            ? { rowCount: 1, rows: [{ id: 'task-residual-1' }] }
            : { rowCount: 0, rows: [] };
        }
        if (sql.includes('workflow_id = ANY($2::uuid[])')) {
          const workspaceId = params?.[3];
          if (workspaceId == null) {
            const taskIds = Array.isArray(params?.[2]) ? (params[2] as string[]) : [];
            return {
              rowCount: taskIds.length,
              rows: taskIds.map((id) => ({ id })),
            };
          }
          return {
            rowCount: 2,
            rows: [{ id: 'task-1' }, { id: 'task-standalone-1' }],
          };
        }
        const taskIds = Array.isArray(params?.[1]) ? (params[1] as string[]) : [];
        return {
          rowCount: taskIds.length,
          rows: taskIds.map((id) => ({ id })),
        };
      }
      if (sql.startsWith('DELETE FROM workflows')) {
        return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
      }
      if (sql.startsWith('DELETE FROM playbooks')) {
        return { rowCount: 2, rows: [{ id: 'playbook-1' }, { id: 'playbook-2' }] };
      }
      if (sql.startsWith('DELETE FROM workspaces')) {
        return { rowCount: 1, rows: [{ id: 'workspace-1' }] };
      }
      return { rowCount: 0, rows: [] };
    }),
    release: vi.fn(),
  };
}

function createBulkWorkflowDeleteClient() {
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rowCount: 0, rows: [] };
      }

      assertSequentialParameters(sql);

      if (sql.includes('SELECT id') && sql.includes('FROM workflows') && sql.includes('id = ANY($2::uuid[])')) {
        expect(params).toEqual(['tenant-1', ['workflow-active', 'workflow-terminal']]);
        return {
          rowCount: 2,
          rows: [{ id: 'workflow-active' }, { id: 'workflow-terminal' }],
        };
      }
      if (sql.includes('SELECT id') && sql.includes('FROM tasks') && sql.includes('workflow_id = ANY($2::uuid[])')) {
        expect(params).toEqual(['tenant-1', ['workflow-active', 'workflow-terminal']]);
        return {
          rowCount: 2,
          rows: [{ id: 'task-active' }, { id: 'task-terminal' }],
        };
      }
      if (sql.startsWith('DELETE FROM tasks') && sql.includes('workflow_id = ANY($2::uuid[])')) {
        return {
          rowCount: 2,
          rows: [{ id: 'task-active' }, { id: 'task-terminal' }],
        };
      }
      if (sql.startsWith('DELETE FROM workflows')) {
        expect(params).toEqual(['tenant-1', ['workflow-active', 'workflow-terminal']]);
        return {
          rowCount: 2,
          rows: [{ id: 'workflow-active' }, { id: 'workflow-terminal' }],
        };
      }
      return { rowCount: 0, rows: [] };
    }),
    release: vi.fn(),
  };
}

function assertSequentialParameters(sql: string): void {
  const placeholders = [...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
  if (placeholders.length === 0) {
    return;
  }
  const unique = [...new Set(placeholders)].sort((left, right) => left - right);
  const expected = Array.from({ length: unique[unique.length - 1] ?? 0 }, (_, index) => index + 1);
  expect(unique).toEqual(expected);
}

function createIdentity() {
  return {
    id: 'key-1',
    tenantId: 'tenant-1',
    scope: 'admin',
    ownerType: 'tenant',
    ownerId: 'tenant-1',
    keyPrefix: 'admin',
  } as const;
}
