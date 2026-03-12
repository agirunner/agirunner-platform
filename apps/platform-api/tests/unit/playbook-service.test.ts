import { describe, expect, it, vi } from 'vitest';

import { ConflictError, SchemaValidationFailedError } from '../../src/errors/domain-errors.js';
import { PlaybookService } from '../../src/services/playbook-service.js';

describe('PlaybookService update behavior', () => {
  it('creates a new version when patching a playbook', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              id: 'playbook-1',
              tenant_id: 'tenant-1',
              name: 'Build Flow',
              slug: 'build-flow',
              description: 'Original',
              outcome: 'Ship it',
              lifecycle: 'standard',
              version: 2,
              definition: {
                board: { columns: [{ id: 'todo', label: 'To Do' }] },
                stages: [{ name: 'build', goal: 'Build' }],
                lifecycle: 'standard',
              },
            },
          ],
        })
        .mockResolvedValueOnce({
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
              definition: {
                board: { columns: [{ id: 'todo', label: 'To Do' }] },
                stages: [{ name: 'build', goal: 'Build' }],
                lifecycle: 'continuous',
              },
            },
          ],
        }),
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
    const [, params] = vi.mocked(pool.query).mock.calls[1];
    expect(params[2]).toBe('build-flow');
    expect(params[6]).toBe(3);
    expect(params[7]).toEqual({
      board: { columns: [{ id: 'todo', label: 'To Do' }] },
      stages: [{ name: 'build', goal: 'Build' }],
      lifecycle: 'continuous',
      roles: [],
    });
  });

  it('replaces a playbook with a new normalized slug version on put', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              id: 'playbook-1',
              tenant_id: 'tenant-1',
              name: 'Build Flow',
              slug: 'build-flow',
              description: 'Original',
              outcome: 'Ship it',
              lifecycle: 'standard',
              version: 1,
              definition: {
                board: { columns: [{ id: 'todo', label: 'To Do' }] },
                stages: [{ name: 'build', goal: 'Build' }],
                lifecycle: 'standard',
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: 'playbook-2', slug: 'release-flow', version: 2 }],
        }),
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

    const [, params] = vi.mocked(pool.query).mock.calls[1];
    expect(params[1]).toBe('Release Flow');
    expect(params[2]).toBe('release-flow');
    expect(params[6]).toBe(2);
  });

  it('rejects invalid updated definitions', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rowCount: 1,
        rows: [
          {
            id: 'playbook-1',
            tenant_id: 'tenant-1',
            name: 'Build Flow',
            slug: 'build-flow',
            description: null,
            outcome: 'Ship it',
            lifecycle: 'standard',
            version: 1,
            definition: {
              board: { columns: [{ id: 'todo', label: 'To Do' }] },
              stages: [{ name: 'build', goal: 'Build' }],
              lifecycle: 'standard',
            },
          },
        ],
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
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              id: 'playbook-1',
              tenant_id: 'tenant-1',
              name: 'Build Flow',
              slug: 'build-flow',
              description: null,
              outcome: 'Ship it',
              lifecycle: 'standard',
              version: 1,
              definition: {
                board: { columns: [{ id: 'todo', label: 'To Do' }] },
                stages: [{ name: 'build', goal: 'Build' }],
                lifecycle: 'standard',
              },
            },
          ],
        })
        .mockRejectedValueOnce({
          code: '23505',
          constraint: 'uq_playbooks_tenant_slug_version',
        }),
    };

    const service = new PlaybookService(pool as never);

    await expect(
      service.updatePlaybook('tenant-1', 'playbook-1', {
        description: 'Updated',
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
