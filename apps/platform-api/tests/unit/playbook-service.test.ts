import { describe, expect, it, vi } from 'vitest';

import { ConflictError, SchemaValidationFailedError, ValidationError } from '../../src/errors/domain-errors.js';
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
            lifecycle: 'ongoing',
            version: 3,
            is_active: true,
            definition: {
              process_instructions: 'Developer implements and reviewer validates before completion.',
              board: { columns: [{ id: 'todo', label: 'To Do' }] },
              stages: [{ name: 'build', goal: 'Build' }],
              lifecycle: 'ongoing',
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
      lifecycle: 'ongoing',
      definition: {
        process_instructions: 'Developer implements and reviewer validates before completion.',
        board: { columns: [{ id: 'todo', label: 'To Do' }] },
        stages: [{ name: 'build', goal: 'Build' }],
        lifecycle: 'ongoing',
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
      expect.arrayContaining(['tenant-1', 'Build Flow', 'build-flow', 'Updated', 'Ship it', 'ongoing', 3]),
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
        process_instructions: 'Release work is implemented and reviewed before shipping.',
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

  it('returns revision and permanent delete impact summaries', async () => {
    const destructiveDeleteService = {
      getPlaybookDeleteImpact: vi.fn().mockResolvedValue({
        revision: {
          workflows: 2,
          active_workflows: 1,
          tasks: 5,
          active_tasks: 2,
          work_items: 3,
        },
        family: {
          revisions: 4,
          workflows: 7,
          active_workflows: 2,
          tasks: 16,
          active_tasks: 4,
          work_items: 9,
        },
      }),
    };
    const service = new PlaybookService({} as never, { destructiveDeleteService } as never);

    await expect(service.getPlaybookDeleteImpact('tenant-1', 'playbook-1')).resolves.toEqual({
      revision: {
        workflows: 2,
        active_workflows: 1,
        tasks: 5,
        active_tasks: 2,
        work_items: 3,
      },
      family: {
        revisions: 4,
        workflows: 7,
        active_workflows: 2,
        tasks: 16,
        active_tasks: 4,
        work_items: 9,
      },
    });
    expect(destructiveDeleteService.getPlaybookDeleteImpact).toHaveBeenCalledWith(
      'tenant-1',
      'playbook-1',
    );
  });

  it('deletes a playbook family permanently through the destructive delete service', async () => {
    const destructiveDeleteService = {
      deletePlaybookPermanently: vi.fn().mockResolvedValue({
        id: 'playbook-1',
        deleted: true,
        deleted_revision_count: 4,
        deleted_workflow_count: 7,
      }),
    };
    const identity = {
      tenantId: 'tenant-1',
      scope: 'admin',
      ownerType: 'tenant',
      ownerId: 'tenant-1',
      keyPrefix: 'admin',
      id: 'key-1',
    };
    const service = new PlaybookService({} as never, { destructiveDeleteService } as never);

    await expect(service.deletePlaybookPermanently(identity as never, 'playbook-1')).resolves.toEqual({
      id: 'playbook-1',
      deleted: true,
      deleted_revision_count: 4,
      deleted_workflow_count: 7,
    });
    expect(destructiveDeleteService.deletePlaybookPermanently).toHaveBeenCalledWith(
      identity,
      'playbook-1',
    );
  });

  it('rejects playbook roles that are not active role definitions', async () => {
    const pool = {
      query: vi.fn().mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ name: 'developer' }],
      }),
    };

    const service = new PlaybookService(pool as never);

    await expect(
      service.createPlaybook('tenant-1', {
        name: 'Build Flow',
        outcome: 'Ship it',
        definition: {
          process_instructions: 'Developer implements and reviewer validates before completion.',
          board: { columns: [{ id: 'todo', label: 'To Do' }] },
          stages: [{ name: 'build', goal: 'Build' }],
          roles: ['developer', 'missing-role'],
        },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
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
    lifecycle: 'planned',
    version: 1,
    is_active: true,
    definition: {
      process_instructions: 'Developer implements and reviewer validates before completion.',
      board: { columns: [{ id: 'todo', label: 'To Do' }] },
      stages: [{ name: 'build', goal: 'Build' }],
      lifecycle: 'planned',
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
