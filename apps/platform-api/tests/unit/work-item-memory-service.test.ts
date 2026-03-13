import { describe, expect, it, vi } from 'vitest';

import { WorkItemService } from '../../src/services/work-item-service.js';

describe('WorkItemService work-item memory support', () => {
  it('returns only current memory keys whose latest write belongs to the work item', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{ id: 'wi-1', workflow_id: 'wf-1', project_id: 'project-1' }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{ memory: { summary: 'Scoped note', unrelated: 'Skip me' } }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 11,
              type: 'project.memory_updated',
              actor_type: 'agent',
              actor_id: 'agent:key',
              created_at: '2026-03-11T10:00:00.000Z',
              data: {
                key: 'summary',
                workflow_id: 'wf-1',
                work_item_id: 'wi-1',
                task_id: 'task-1',
                stage_name: 'design',
              },
            },
            {
              id: 12,
              type: 'project.memory_updated',
              actor_type: 'agent',
              actor_id: 'agent:key',
              created_at: '2026-03-11T11:00:00.000Z',
              data: {
                key: 'unrelated',
                workflow_id: 'wf-1',
                work_item_id: 'wi-2',
              },
            },
          ],
          rowCount: 2,
        }),
    };
    const service = new WorkItemService(
      pool as never,
      { emit: vi.fn() } as never,
      { enqueueForWorkflow: vi.fn() } as never,
      { dispatchActivation: vi.fn() } as never,
    );

    const result = await service.getWorkItemMemory('tenant-1', 'wf-1', 'wi-1');

    expect(result.entries).toEqual([
      {
        key: 'summary',
        value: 'Scoped note',
        event_id: 11,
        updated_at: '2026-03-11T10:00:00.000Z',
        actor_type: 'agent',
        actor_id: 'agent:key',
        workflow_id: 'wf-1',
        work_item_id: 'wi-1',
        task_id: 'task-1',
        stage_name: 'design',
      },
    ]);
  });

  it('returns scoped memory history from project memory events', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{ id: 'wi-1', workflow_id: 'wf-1', project_id: 'project-1' }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 21,
              type: 'project.memory_deleted',
              actor_type: 'agent',
              actor_id: 'agent:key',
              created_at: '2026-03-11T12:00:00.000Z',
              data: {
                key: 'summary',
                deleted_value: 'Old note',
                workflow_id: 'wf-1',
                work_item_id: 'wi-1',
                task_id: 'task-1',
                stage_name: 'design',
              },
            },
          ],
          rowCount: 1,
        }),
    };
    const service = new WorkItemService(
      pool as never,
      { emit: vi.fn() } as never,
      { enqueueForWorkflow: vi.fn() } as never,
      { dispatchActivation: vi.fn() } as never,
    );

    const result = await service.getWorkItemMemoryHistory('tenant-1', 'wf-1', 'wi-1', 50);

    expect(result.history).toEqual([
      {
        key: 'summary',
        value: 'Old note',
        event_id: 21,
        event_type: 'deleted',
        updated_at: '2026-03-11T12:00:00.000Z',
        actor_type: 'agent',
        actor_id: 'agent:key',
        workflow_id: 'wf-1',
        work_item_id: 'wi-1',
        task_id: 'task-1',
        stage_name: 'design',
      },
    ]);
  });

  it('redacts secret-bearing current memory values in scoped memory responses', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{ id: 'wi-1', workflow_id: 'wf-1', project_id: 'project-1' }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{ memory: { api_token: { token: 'plain-secret', secret_ref: 'secret:API_TOKEN' } } }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 11,
              type: 'project.memory_updated',
              actor_type: 'agent',
              actor_id: 'agent:key',
              created_at: '2026-03-11T10:00:00.000Z',
              data: {
                key: 'api_token',
                workflow_id: 'wf-1',
                work_item_id: 'wi-1',
              },
            },
          ],
          rowCount: 1,
        }),
    };
    const service = new WorkItemService(
      pool as never,
      { emit: vi.fn() } as never,
      { enqueueForWorkflow: vi.fn() } as never,
      { dispatchActivation: vi.fn() } as never,
    );

    const result = await service.getWorkItemMemory('tenant-1', 'wf-1', 'wi-1');

    expect(result.entries[0]?.value).toEqual({
      token: 'redacted://project-memory-secret',
      secret_ref: 'redacted://project-memory-secret',
    });
  });

  it('redacts plaintext secret-bearing history values from legacy project memory events', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{ id: 'wi-1', workflow_id: 'wf-1', project_id: 'project-1' }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 21,
              type: 'project.memory_deleted',
              actor_type: 'agent',
              actor_id: 'agent:key',
              created_at: '2026-03-11T12:00:00.000Z',
              data: {
                key: 'credentials',
                deleted_value: {
                  password: 'Old secret',
                  secret_ref: 'secret:DB_PASSWORD',
                },
                workflow_id: 'wf-1',
                work_item_id: 'wi-1',
              },
            },
          ],
          rowCount: 1,
        }),
    };
    const service = new WorkItemService(
      pool as never,
      { emit: vi.fn() } as never,
      { enqueueForWorkflow: vi.fn() } as never,
      { dispatchActivation: vi.fn() } as never,
    );

    const result = await service.getWorkItemMemoryHistory('tenant-1', 'wf-1', 'wi-1', 50);

    expect(result.history[0]?.value).toEqual({
      password: 'redacted://project-memory-secret',
      secret_ref: 'redacted://project-memory-secret',
    });
  });

  it('redacts secret-like memory values even when the memory key is not secret-like', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{ id: 'wi-1', workflow_id: 'wf-1', project_id: 'project-1' }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 21,
              type: 'project.memory_updated',
              actor_type: 'agent',
              actor_id: 'agent:key',
              created_at: '2026-03-11T12:00:00.000Z',
              data: {
                key: 'summary',
                value: {
                  note: 'Bearer real-secret',
                  session: 'eyJhbGciOiJIUzI1NiJ9.payload.signature',
                },
                workflow_id: 'wf-1',
                work_item_id: 'wi-1',
              },
            },
          ],
          rowCount: 1,
        }),
    };
    const service = new WorkItemService(
      pool as never,
      { emit: vi.fn() } as never,
      { enqueueForWorkflow: vi.fn() } as never,
      { dispatchActivation: vi.fn() } as never,
    );

    const result = await service.getWorkItemMemoryHistory('tenant-1', 'wf-1', 'wi-1', 50);

    expect(result.history[0]?.value).toEqual({
      note: 'redacted://project-memory-secret',
      session: 'redacted://project-memory-secret',
    });
  });
});
