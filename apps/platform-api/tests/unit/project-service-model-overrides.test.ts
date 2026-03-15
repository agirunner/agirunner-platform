import { describe, expect, it, vi } from 'vitest';

import { ProjectService } from '../../src/services/project-service.js';

describe('ProjectService model overrides', () => {
  it('drops retired project model overrides during project updates', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{
            id: 'project-1',
            tenant_id: 'tenant-1',
            name: 'Project',
            slug: 'project',
            settings: {},
          }],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{
            id: 'project-1',
            tenant_id: 'tenant-1',
            name: 'Project',
            slug: 'project',
            settings: {
              model_overrides: {},
            },
          }],
        }),
    };

    const service = new ProjectService(
      pool as never,
      { emit: vi.fn(async () => undefined) } as never,
    );

    const project = await service.updateProject(
      {
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'tenant',
        ownerId: 'tenant-1',
        keyPrefix: 'admin-key',
        id: 'key-1',
      } as never,
      'project-1',
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
    );

    expect((project.settings as Record<string, unknown>).model_overrides).toEqual({});
  });
});
