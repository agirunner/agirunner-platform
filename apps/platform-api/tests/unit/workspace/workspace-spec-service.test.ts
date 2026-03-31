import { describe, expect, it, vi } from 'vitest';

import { WorkspaceSpecService } from '../../../src/services/workspace/workspace-spec-service.js';

const TENANT_ID = 'tenant-1';
const WORKSPACE_ID = 'workspace-1';

function createEventService() {
  return { emit: vi.fn(async () => undefined) };
}

describe('WorkspaceSpecService secret handling', () => {
  it('redacts legacy secret-bearing values from workspace spec reads', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: WORKSPACE_ID, current_spec_version: 2 }],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{
            id: 'spec-2',
            version: 2,
            spec: {
              config: {
                deployment: {
                  api_token: 'plain-secret-token',
                  ref: 'secret:DEPLOY_TOKEN',
                },
              },
              documents: {
                runbook: {
                  source: 'repository',
                  path: 'docs/runbook.md',
                  metadata: {
                    authorization: 'Bearer top-secret',
                    preserved_ref: 'secret:DOC_TOKEN',
                  },
                },
              },
            },
            created_at: new Date('2026-03-12T00:00:00.000Z'),
            created_by_type: 'admin',
            created_by_id: 'key-1',
          }],
        }),
    };

    const service = new WorkspaceSpecService(pool as never, createEventService() as never);

    const result = await service.getWorkspaceSpec(TENANT_ID, WORKSPACE_ID);

    expect(result.spec).toEqual({
      config: {
        deployment: {
          api_token: 'redacted://workspace-spec-secret',
          ref: 'redacted://workspace-spec-secret',
        },
      },
      documents: {
        runbook: {
          source: 'repository',
          path: 'docs/runbook.md',
          metadata: {
            authorization: 'redacted://workspace-spec-secret',
            preserved_ref: 'redacted://workspace-spec-secret',
          },
        },
      },
    });
  });

  it('rejects plaintext secret-bearing values when writing workspace specs', async () => {
    const pool = {
      connect: vi.fn(),
      query: vi.fn(),
    };

    const service = new WorkspaceSpecService(pool as never, createEventService() as never);

    await expect(
      service.putWorkspaceSpec(
        {
          id: 'key-1',
          tenantId: TENANT_ID,
          scope: 'admin',
          ownerType: 'tenant',
          ownerId: TENANT_ID,
          keyPrefix: 'admin-key',
        } as never,
        WORKSPACE_ID,
        {
          config: {
            deployment: {
              api_token: 'plain-secret-token',
            },
          },
        },
      ),
    ).rejects.toThrow('Workspace spec contains plaintext secret-bearing values');

    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('allows secret references when writing workspace specs', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: WORKSPACE_ID, current_spec_version: 1 }] })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{
            version: 2,
            created_at: new Date('2026-03-12T00:00:00.000Z'),
            created_by_type: 'admin',
            created_by_id: 'key-1',
          }],
        })
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{
            id: 'spec-2',
            version: 2,
            spec: {
              config: {
                deployment: {
                  ref: 'secret:DEPLOY_TOKEN',
                },
              },
            },
            created_at: new Date('2026-03-12T00:00:00.000Z'),
            created_by_type: 'admin',
            created_by_id: 'key-1',
          }],
        }),
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn(async () => client),
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: WORKSPACE_ID, current_spec_version: 2 }],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{
            id: 'spec-2',
            version: 2,
            spec: {
              config: {
                deployment: {
                  ref: 'secret:DEPLOY_TOKEN',
                },
              },
            },
            created_at: new Date('2026-03-12T00:00:00.000Z'),
            created_by_type: 'admin',
            created_by_id: 'key-1',
          }],
        }),
    };

    const service = new WorkspaceSpecService(pool as never, createEventService() as never);

    const result = await service.putWorkspaceSpec(
      {
        id: 'key-1',
        tenantId: TENANT_ID,
        scope: 'admin',
        ownerType: 'tenant',
        ownerId: TENANT_ID,
        keyPrefix: 'admin-key',
      } as never,
      WORKSPACE_ID,
      {
        config: {
          deployment: {
            ref: 'secret:DEPLOY_TOKEN',
          },
        },
      },
    );

    expect(result.spec).toEqual({
      config: {
        deployment: {
          ref: 'redacted://workspace-spec-secret',
        },
      },
    });
    expect(client.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('INSERT INTO workspace_spec_versions'),
      expect.arrayContaining([
        TENANT_ID,
        WORKSPACE_ID,
        2,
        {
          config: {
            deployment: {
              ref: 'secret:DEPLOY_TOKEN',
            },
          },
        },
      ]),
    );
  });

  it('redacts legacy secret-bearing workspace resource fields on resource reads', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: WORKSPACE_ID, current_spec_version: 4 }],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{
            id: 'spec-4',
            version: 4,
            spec: {
              resources: {
                repo: {
                  type: 'repository',
                  binding: {
                    url: 'https://github.com/agisnap/demo',
                    authorization: 'Bearer ghp-secret',
                  },
                  notes: 'Bearer hidden-token',
                },
              },
            },
            created_at: new Date('2026-03-12T00:00:00.000Z'),
            created_by_type: 'admin',
            created_by_id: 'key-1',
          }],
        }),
    };

    const service = new WorkspaceSpecService(pool as never, createEventService() as never);

    const result = await service.listWorkspaceResources(
      {
        id: 'key-1',
        tenantId: TENANT_ID,
        scope: 'admin',
        ownerType: 'tenant',
        ownerId: TENANT_ID,
        keyPrefix: 'admin-key',
      } as never,
      WORKSPACE_ID,
      {},
    );

    expect(result).toEqual({
      data: [
        {
          logical_name: 'repo',
          type: 'repository',
          binding: {
            url: 'https://github.com/agisnap/demo',
            authorization: 'redacted://workspace-spec-secret',
          },
          notes: 'redacted://workspace-spec-secret',
        },
      ],
    });
  });
});
