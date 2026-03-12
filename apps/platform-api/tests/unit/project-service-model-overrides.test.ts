import { describe, expect, it, vi } from 'vitest';

import { ProjectService } from '../../src/services/project-service.js';

describe('ProjectService model overrides', () => {
  it('validates project model override references during project updates', async () => {
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
          rows: [{ id: '00000000-0000-0000-0000-000000000020' }],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{
            id: 'project-1',
            tenant_id: 'tenant-1',
            name: 'Project',
            slug: 'project',
            settings: {
              model_override: {
                model_id: '00000000-0000-0000-0000-000000000020',
              },
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
          model_override: {
            model_id: '00000000-0000-0000-0000-000000000020',
          },
        },
      },
    );

    expect((project.settings as Record<string, unknown>).model_override).toEqual({
      model_id: '00000000-0000-0000-0000-000000000020',
    });
  });
});
