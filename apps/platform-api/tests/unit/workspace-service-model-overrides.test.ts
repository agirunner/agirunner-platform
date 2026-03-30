import { describe, expect, it, vi } from 'vitest';

import { WorkspaceService } from '../../src/services/workspace-service.js';

describe('WorkspaceService model overrides', () => {
  it('rejects retired legacy model overrides during workspace updates', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{
            id: 'workspace-1',
            tenant_id: 'tenant-1',
            name: 'Workspace',
            slug: 'workspace',
            settings: {},
          }],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{
            id: 'workspace-1',
            tenant_id: 'tenant-1',
            name: 'Workspace',
            slug: 'workspace',
            settings: {},
          }],
        }),
    };

    const service = new WorkspaceService(
      pool as never,
      { emit: vi.fn(async () => undefined) } as never,
    );

    await expect(
      service.updateWorkspace(
        {
          tenantId: 'tenant-1',
          scope: 'admin',
          ownerType: 'tenant',
          ownerId: 'tenant-1',
          keyPrefix: 'admin-key',
          id: 'key-1',
        } as never,
        'workspace-1',
        {
          settings: {
            model_overrides: {
              developer: {
                provider: 'openai',
                model: 'gpt-5',
              },
            },
          },
        },
      ),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: expect.stringMatching(/model_overrides.*no longer supported/i),
    });
  });
});
