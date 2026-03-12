import { describe, expect, it, vi } from 'vitest';

import { ConflictError, SchemaValidationFailedError } from '../../src/errors/domain-errors.js';
import { PlaybookService } from '../../src/services/playbook-service.js';

describe('PlaybookService', () => {
  it('creates a new active version when patching a playbook and deactivates prior revisions', async () => {
    const client = createTransactionalClient([
      { rowCount: null, rows: [] },
      { rowCount: null, rows: [] },
      {
        rowCount: 1,
        rows: [
          {
            id: 'playbook-2',
            tenant_id: 'tenant-1',
            name: 'Build Flow',
            slug: 'build-flow',
            description: 'Updated',
            outcome: 'Ship it',
            lifecycle: 'continuous',
            version: 3,
            is_active: true,
            definition: {
              board: { columns: [{ id: 'todo', label: 'To Do' }] },
              stages: [{ name: 'build', goal: 'Build' }],
              lifecycle: 'continuous',
              roles: [],
            },
          },
        ],
      },
      { rowCount: null, rows: [] },
    ]);
    const pool = {
      query: vi.fn().mockResolvedValueOnce({
        rowCount: 1,
        rows: [createPlaybookRow({ version: 2 })],
      }),
      connect: vi.fn().mockResolvedValue(client),
    };

    const service = new PlaybookService(pool as never);

    const playbook = await service.updatePlaybook('tenant-1', 'playbook-1', {
      description: 'Updated',
      lifecycle: 'continuous',
      definition: {
        board: { columns: [{ id: 'todo', label: 'To Do' }] },
        stages: [{ name: 'build', goal: 'Build' }],
        lifecycle: 'continuous',
      },
    });

    expect(playbook.id).toBe('playbook-2');
    expect(client.query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(client.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE playbooks'),
      ['tenant-1', 'build-flow'],
    );
    expect(client.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('INSERT INTO playbooks'),
      expect.arrayContaining(['tenant-1', 'Build Flow', 'build-flow', 'Updated', 'Ship it', 'continuous', 3]),
    );
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  it('replaces a playbook with a new normalized slug version on put', async () => {
    const client = createTransactionalClient([
      { rowCount: null, rows: [] },
      { rowCount: null, rows: [] },
      { rowCount: 1, rows: [{ id: 'playbook-2', slug: 'release-flow', version: 2, is_active: true }] },
      { rowCount: null, rows: [] },
    ]);
    const pool = {
      query: vi.fn().mockResolvedValueOnce({
        rowCount: 1,
        rows: [createPlaybookRow({ version: 1 })],
      }),
      connect: vi.fn().mockResolvedValue(client),
    };

    const service = new PlaybookService(pool as never);

    await service.replacePlaybook('tenant-1', 'playbook-1', {
      name: 'Release Flow',
      outcome: 'Release',
      definition: {
        board: { columns: [{ id: 'todo', label: 'To Do' }] },
        stages: [{ name: 'release', goal: 'Release' }],
      },
    });

    const [, params] = vi.mocked(client.query).mock.calls[2];
    expect(params[1]).toBe('Release Flow');
    expect(params[2]).toBe('release-flow');
    expect(params[6]).toBe(2);
  });

  it('archives an entire active playbook family and can restore a chosen revision', async () => {
    const archiveClient = createTransactionalClient([
      { rowCount: null, rows: [] },
      { rowCount: null, rows: [] },
      { rowCount: null, rows: [] },
    ]);
    const restoreClient = createTransactionalClient([
      { rowCount: null, rows: [] },
      { rowCount: null, rows: [] },
      {
        rowCount: 1,
        rows: [createPlaybookRow({ id: 'playbook-2', version: 2, is_active: true })],
      },
      { rowCount: null, rows: [] },
    ]);
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [createPlaybookRow({ id: 'playbook-2', version: 2, is_active: true })],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [createPlaybookRow({ id: 'playbook-2', version: 2, is_active: false })],
        }),
      connect: vi
        .fn()
        .mockResolvedValueOnce(archiveClient)
        .mockResolvedValueOnce(restoreClient),
    };

    const service = new PlaybookService(pool as never);

    const archived = await service.setPlaybookArchived('tenant-1', 'playbook-2', true);
    const restored = await service.setPlaybookArchived('tenant-1', 'playbook-2', false);

    expect(archived.is_active).toBe(false);
    expect(restoreClient.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE playbooks'),
      ['tenant-1', 'build-flow'],
    );
    expect(restoreClient.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('UPDATE playbooks'),
      ['tenant-1', 'playbook-2'],
    );
    expect(restored.is_active).toBe(true);
  });

  it('deletes an unreferenced playbook and blocks deletion when workflows still reference it', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [createPlaybookRow()],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ total: '0' }],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: 'playbook-1' }],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [createPlaybookRow()],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ total: '2' }],
        }),
    };

    const service = new PlaybookService(pool as never);

    await expect(service.deletePlaybook('tenant-1', 'playbook-1')).resolves.toEqual({
      id: 'playbook-1',
      deleted: true,
    });
    await expect(service.deletePlaybook('tenant-1', 'playbook-1')).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('rejects invalid updated definitions', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rowCount: 1,
        rows: [createPlaybookRow()],
      }),
    };

    const service = new PlaybookService(pool as never);

    await expect(
      service.updatePlaybook('tenant-1', 'playbook-1', {
        definition: {
          board: { columns: [] },
        },
      }),
    ).rejects.toBeInstanceOf(SchemaValidationFailedError);
  });

  it('maps duplicate slug versions to a conflict error', async () => {
    const client = createTransactionalClient([
      { rowCount: null, rows: [] },
      { rowCount: null, rows: [] },
      { code: '23505', constraint: 'uq_playbooks_tenant_slug_version' },
      { rowCount: null, rows: [] },
    ]);
    const pool = {
      query: vi.fn().mockResolvedValueOnce({
        rowCount: 1,
        rows: [createPlaybookRow()],
      }),
      connect: vi.fn().mockResolvedValue(client),
    };

    const service = new PlaybookService(pool as never);

    await expect(
      service.updatePlaybook('tenant-1', 'playbook-1', {
        description: 'Updated',
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
  });
});

function createPlaybookRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'playbook-1',
    tenant_id: 'tenant-1',
    name: 'Build Flow',
    slug: 'build-flow',
    description: 'Original',
    outcome: 'Ship it',
    lifecycle: 'standard',
    version: 1,
    is_active: true,
    definition: {
      board: { columns: [{ id: 'todo', label: 'To Do' }] },
      stages: [{ name: 'build', goal: 'Build' }],
      lifecycle: 'standard',
    },
    ...overrides,
  };
}

function createTransactionalClient(responses: Array<unknown>) {
  const query = vi.fn();
  for (const response of responses) {
    if (
      response &&
      typeof response === 'object' &&
      'code' in (response as Record<string, unknown>)
    ) {
      query.mockRejectedValueOnce(response);
      continue;
    }
    query.mockResolvedValueOnce(response);
  }
  return {
    query,
    release: vi.fn(),
  };
}
