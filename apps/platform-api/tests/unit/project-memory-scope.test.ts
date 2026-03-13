import { describe, expect, it, vi } from 'vitest';

import { ProjectService } from '../../src/services/project-service.js';

describe('ProjectService memory scope events', () => {
  it('emits workflow and work-item context when memory is patched', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ id: 'project-1', memory: { summary: 'Scoped note' }, memory_max_bytes: 1_048_576 }],
        rowCount: 1,
      }),
    };
    const eventService = { emit: vi.fn().mockResolvedValue(undefined) };
    const service = new ProjectService(pool as never, eventService as never);
    vi.spyOn(service, 'getProject').mockResolvedValue({
      id: 'project-1',
      memory: {},
      memory_max_bytes: 1_048_576,
    } as never);

    await service.patchProjectMemory(
      {
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'agent:key',
        id: 'key-1',
      },
      'project-1',
      {
        key: 'summary',
        value: 'Scoped note',
        context: {
          workflow_id: 'wf-1',
          work_item_id: 'wi-1',
          task_id: 'task-1',
          stage_name: 'design',
        },
      },
    );

    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'project.memory_updated',
        data: expect.objectContaining({
          key: 'summary',
          value: 'Scoped note',
          project_id: 'project-1',
          workflow_id: 'wf-1',
          work_item_id: 'wi-1',
          task_id: 'task-1',
          stage_name: 'design',
        }),
      }),
      undefined,
    );
  });

  it('redacts secret-bearing patched values before emitting memory events', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ id: 'project-1', memory: { api_token: 'top-secret' }, memory_max_bytes: 1_048_576 }],
        rowCount: 1,
      }),
    };
    const eventService = { emit: vi.fn().mockResolvedValue(undefined) };
    const service = new ProjectService(pool as never, eventService as never);
    vi.spyOn(service, 'getProject').mockResolvedValue({
      id: 'project-1',
      memory: {},
      memory_max_bytes: 1_048_576,
    } as never);

    await service.patchProjectMemory(
      {
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'agent:key',
        id: 'key-1',
      },
      'project-1',
      {
        key: 'api_token',
        value: {
          token: 'top-secret',
          secret_ref: 'secret:API_TOKEN',
          nested: { authorization: 'Bearer real-secret', note: 'safe' },
        },
      },
    );

    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'project.memory_updated',
        data: expect.objectContaining({
          key: 'api_token',
          value: {
            token: 'redacted://project-memory-secret',
            secret_ref: 'redacted://project-memory-secret',
            nested: {
              authorization: 'redacted://project-memory-secret',
              note: 'redacted://project-memory-secret',
            },
          },
        }),
      }),
      undefined,
    );
  });

  it('redacts secret-bearing deleted values before emitting delete events', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ id: 'project-1', memory: {}, memory_max_bytes: 1_048_576 }],
        rowCount: 1,
      }),
    };
    const eventService = { emit: vi.fn().mockResolvedValue(undefined) };
    const service = new ProjectService(pool as never, eventService as never);
    vi.spyOn(service, 'getProject').mockResolvedValue({
      id: 'project-1',
      memory: {
        credentials: {
          password: 'super-secret',
          secret_ref: 'secret:DB_PASSWORD',
        },
      },
      memory_max_bytes: 1_048_576,
    } as never);

    await service.removeProjectMemory(
      {
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'agent:key',
        id: 'key-1',
      },
      'project-1',
      'credentials',
    );

    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'project.memory_deleted',
        data: expect.objectContaining({
          key: 'credentials',
          deleted_value: {
            password: 'redacted://project-memory-secret',
            secret_ref: 'redacted://project-memory-secret',
          },
        }),
      }),
      undefined,
    );
  });
});
