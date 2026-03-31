import { describe, expect, it, vi } from 'vitest';

import { ConflictError } from '../../../src/errors/domain-errors.js';
import { WorkspaceService } from '../../../src/services/workspace/workspace-service.js';
import {
  createEventService,
  createIdentity,
} from './workspace-test-helpers.js';

describe('WorkspaceService deletion contract', () => {
  it('returns a workspace delete impact summary', async () => {
    const destructiveDeleteService = {
      getWorkspaceDeleteImpact: vi.fn().mockResolvedValue({
        workflows: 3,
        active_workflows: 1,
        tasks: 9,
        active_tasks: 2,
        work_items: 4,
      }),
    };
    const service = new WorkspaceService(
      {} as never,
      createEventService() as never,
      undefined,
      { destructiveDeleteService } as never,
    );

    await expect(
      service.getWorkspaceDeleteImpact(createIdentity() as never, 'workspace-1'),
    ).resolves.toEqual({
      workflows: 3,
      active_workflows: 1,
      tasks: 9,
      active_tasks: 2,
      work_items: 4,
    });
    expect(destructiveDeleteService.getWorkspaceDeleteImpact).toHaveBeenCalledWith(
      'tenant-1',
      'workspace-1',
    );
  });

  it('blocks default workspace deletion when dependencies exist and uses destructive delete for cascade removal', async () => {
    const destructiveDeleteService = {
      getWorkspaceDeleteImpact: vi
        .fn()
        .mockResolvedValueOnce({
          workflows: 2,
          active_workflows: 1,
          tasks: 7,
          active_tasks: 2,
          work_items: 3,
        })
        .mockResolvedValueOnce({
          workflows: 2,
          active_workflows: 1,
          tasks: 7,
          active_tasks: 2,
          work_items: 3,
        }),
      deleteWorkspaceWithoutDependencies: vi.fn(),
      deleteWorkspaceCascading: vi.fn().mockResolvedValue({
        id: 'workspace-1',
        deleted: true,
        deleted_workflow_count: 2,
        deleted_task_count: 7,
      }),
    };
    const service = new WorkspaceService(
      {} as never,
      createEventService() as never,
      undefined,
      { destructiveDeleteService } as never,
    );
    const identity = createIdentity();

    await expect(service.deleteWorkspace(identity as never, 'workspace-1')).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(
      service.deleteWorkspace(identity as never, 'workspace-1', { cascade: true }),
    ).resolves.toEqual({
      id: 'workspace-1',
      deleted: true,
      deleted_workflow_count: 2,
      deleted_task_count: 7,
    });
    expect(destructiveDeleteService.deleteWorkspaceCascading).toHaveBeenCalledWith(
      identity,
      'workspace-1',
    );
  });

  it('uses destructive cleanup for workspace deletion after dependency checks pass', async () => {
    const eventService = createEventService();
    const destructiveDeleteService = {
      getWorkspaceDeleteImpact: vi.fn().mockResolvedValue({
        workflows: 0,
        active_workflows: 0,
        tasks: 0,
        active_tasks: 0,
        work_items: 0,
      }),
      deleteWorkspaceWithoutDependencies: vi.fn().mockResolvedValue({
        id: 'workspace-1',
        deleted: true,
      }),
      deleteWorkspaceCascading: vi.fn(),
    };
    const pool = {
      query: vi.fn(),
    };
    const service = new WorkspaceService(
      pool as never,
      eventService as never,
      undefined,
      { destructiveDeleteService } as never,
    );
    const identity = createIdentity();

    await expect(service.deleteWorkspace(identity as never, 'workspace-1')).resolves.toEqual({
      id: 'workspace-1',
      deleted: true,
    });

    expect(destructiveDeleteService.deleteWorkspaceWithoutDependencies).toHaveBeenCalledWith(
      identity,
      'workspace-1',
    );
    expect(pool.query).not.toHaveBeenCalled();
    expect(eventService.emit).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      type: 'workspace.deleted',
      entityType: 'workspace',
      entityId: 'workspace-1',
      actorType: 'admin',
      actorId: 'admin-key',
      data: {},
    });
  });
});
