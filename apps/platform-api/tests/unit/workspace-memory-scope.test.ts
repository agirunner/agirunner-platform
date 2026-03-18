import { describe, expect, it, vi } from 'vitest';

import { WorkspaceService } from '../../src/services/workspace-service.js';

describe('WorkspaceService memory scope events', () => {
  it('applies batched memory updates atomically and emits one scoped event per entry', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('FROM workspaces') && sql.includes('FOR UPDATE')) {
          expect(params).toEqual(['tenant-1', 'workspace-1']);
          return {
            rows: [{
              id: 'workspace-1',
              memory: {},
              memory_max_bytes: 1_048_576,
            }],
            rowCount: 1,
          };
        }
        if (sql.startsWith('UPDATE workspaces')) {
          const nextMemory = params?.[2] as Record<string, unknown>;
          if (!('decision' in nextMemory)) {
            return {
              rows: [{
                id: 'workspace-1',
                memory: { summary: 'First scoped note' },
                memory_max_bytes: 1_048_576,
              }],
              rowCount: 1,
            };
          }
          return {
            rows: [{
              id: 'workspace-1',
              memory: {
                summary: 'First scoped note',
                decision: { outcome: 'ship', secret_ref: 'secret:DECISION_TOKEN' },
              },
              memory_max_bytes: 1_048_576,
            }],
            rowCount: 1,
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn().mockResolvedValue(client) };
    const eventService = { emit: vi.fn().mockResolvedValue(undefined) };
    const service = new WorkspaceService(pool as never, eventService as never);

    const result = await service.patchWorkspaceMemoryEntries(
      {
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'agent:key',
        id: 'key-1',
      },
      'workspace-1',
      [
        {
          key: 'summary',
          value: 'First scoped note',
          context: {
            workflow_id: 'wf-1',
            work_item_id: 'wi-1',
            task_id: 'task-1',
            stage_name: 'design',
          },
        },
        {
          key: 'decision',
          value: { outcome: 'ship', secret_ref: 'secret:DECISION_TOKEN' },
          context: {
            workflow_id: 'wf-1',
            work_item_id: 'wi-1',
            task_id: 'task-1',
            stage_name: 'design',
          },
        },
      ],
    );

    expect(result.memory).toEqual({
      summary: 'First scoped note',
      decision: {
        outcome: 'ship',
        secret_ref: 'redacted://workspace-memory-secret',
      },
    });
    expect(eventService.emit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'workspace.memory_updated',
        data: expect.objectContaining({
          key: 'summary',
          value: 'First scoped note',
          work_item_id: 'wi-1',
        }),
      }),
      client,
    );
    expect(eventService.emit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'workspace.memory_updated',
        data: expect.objectContaining({
          key: 'decision',
          value: {
            outcome: 'ship',
            secret_ref: 'redacted://workspace-memory-secret',
          },
          work_item_id: 'wi-1',
        }),
      }),
      client,
    );
  });

  it('emits workflow and work-item context when memory is patched', async () => {
    const client = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('FROM workspaces') && sql.includes('FOR UPDATE')) {
          return {
            rows: [{ id: 'workspace-1', memory: {}, memory_max_bytes: 1_048_576 }],
            rowCount: 1,
          };
        }
        return {
          rows: [{ id: 'workspace-1', memory: { summary: 'Scoped note' }, memory_max_bytes: 1_048_576 }],
          rowCount: 1,
        };
      }),
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn().mockResolvedValue(client),
    };
    const eventService = { emit: vi.fn().mockResolvedValue(undefined) };
    const service = new WorkspaceService(pool as never, eventService as never);

    await service.patchWorkspaceMemory(
      {
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'agent:key',
        id: 'key-1',
      },
      'workspace-1',
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
        type: 'workspace.memory_updated',
        data: expect.objectContaining({
          key: 'summary',
          value: 'Scoped note',
          workspace_id: 'workspace-1',
          workflow_id: 'wf-1',
          work_item_id: 'wi-1',
          task_id: 'task-1',
          stage_name: 'design',
        }),
      }),
      client,
    );
  });

  it('redacts secret-bearing patched values before emitting memory events', async () => {
    const client = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('FROM workspaces') && sql.includes('FOR UPDATE')) {
          return {
            rows: [{ id: 'workspace-1', memory: {}, memory_max_bytes: 1_048_576 }],
            rowCount: 1,
          };
        }
        return {
          rows: [{ id: 'workspace-1', memory: { api_token: 'top-secret' }, memory_max_bytes: 1_048_576 }],
          rowCount: 1,
        };
      }),
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn().mockResolvedValue(client),
    };
    const eventService = { emit: vi.fn().mockResolvedValue(undefined) };
    const service = new WorkspaceService(pool as never, eventService as never);

    await service.patchWorkspaceMemory(
      {
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'agent:key',
        id: 'key-1',
      },
      'workspace-1',
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
        type: 'workspace.memory_updated',
        data: expect.objectContaining({
          key: 'api_token',
          value: {
            token: 'redacted://workspace-memory-secret',
            secret_ref: 'redacted://workspace-memory-secret',
            nested: {
              authorization: 'redacted://workspace-memory-secret',
              note: 'redacted://workspace-memory-secret',
            },
          },
        }),
      }),
      client,
    );
  });

  it('redacts secret-bearing deleted values before emitting delete events', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ id: 'workspace-1', memory: {}, memory_max_bytes: 1_048_576 }],
        rowCount: 1,
      }),
    };
    const eventService = { emit: vi.fn().mockResolvedValue(undefined) };
    const service = new WorkspaceService(pool as never, eventService as never);
    vi.spyOn(service, 'getWorkspace').mockResolvedValue({
      id: 'workspace-1',
      memory: {
        credentials: {
          password: 'super-secret',
          secret_ref: 'secret:DB_PASSWORD',
        },
      },
      memory_max_bytes: 1_048_576,
    } as never);

    await service.removeWorkspaceMemory(
      {
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'agent:key',
        id: 'key-1',
      },
      'workspace-1',
      'credentials',
    );

    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workspace.memory_deleted',
        data: expect.objectContaining({
          key: 'credentials',
          deleted_value: {
            password: 'redacted://workspace-memory-secret',
            secret_ref: 'redacted://workspace-memory-secret',
          },
        }),
      }),
      undefined,
    );
  });
});
