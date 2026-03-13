import { describe, expect, it, vi } from 'vitest';

import { ProjectSpecService } from '../../src/services/project-spec-service.js';

const TENANT_ID = 'tenant-1';
const PROJECT_ID = 'project-1';

function createEventService() {
  return { emit: vi.fn(async () => undefined) };
}

describe('ProjectSpecService secret handling', () => {
  it('redacts legacy secret-bearing values from project spec reads', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: PROJECT_ID, current_spec_version: 2 }],
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

    const service = new ProjectSpecService(pool as never, createEventService() as never);

    const result = await service.getProjectSpec(TENANT_ID, PROJECT_ID);

    expect(result.spec).toEqual({
      config: {
        deployment: {
          api_token: 'redacted://project-spec-secret',
          ref: 'secret:DEPLOY_TOKEN',
        },
      },
      documents: {
        runbook: {
          source: 'repository',
          path: 'docs/runbook.md',
          metadata: {
            authorization: 'redacted://project-spec-secret',
            preserved_ref: 'secret:DOC_TOKEN',
          },
        },
      },
    });
  });

  it('rejects plaintext secret-bearing values when writing project specs', async () => {
    const pool = {
      connect: vi.fn(),
      query: vi.fn(),
    };

    const service = new ProjectSpecService(pool as never, createEventService() as never);

    await expect(
      service.putProjectSpec(
        {
          id: 'key-1',
          tenantId: TENANT_ID,
          scope: 'admin',
          ownerType: 'tenant',
          ownerId: TENANT_ID,
          keyPrefix: 'admin-key',
        } as never,
        PROJECT_ID,
        {
          config: {
            deployment: {
              api_token: 'plain-secret-token',
            },
          },
        },
      ),
    ).rejects.toThrow('Project spec contains plaintext secret-bearing values');

    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('redacts legacy secret-bearing project resource fields on resource reads', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: PROJECT_ID, current_spec_version: 4 }],
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

    const service = new ProjectSpecService(pool as never, createEventService() as never);

    const result = await service.listProjectResources(
      {
        id: 'key-1',
        tenantId: TENANT_ID,
        scope: 'admin',
        ownerType: 'tenant',
        ownerId: TENANT_ID,
        keyPrefix: 'admin-key',
      } as never,
      PROJECT_ID,
      {},
    );

    expect(result).toEqual({
      data: [
        {
          logical_name: 'repo',
          type: 'repository',
          binding: {
            url: 'https://github.com/agisnap/demo',
            authorization: 'redacted://project-spec-secret',
          },
          notes: 'redacted://project-spec-secret',
        },
      ],
    });
  });
});
