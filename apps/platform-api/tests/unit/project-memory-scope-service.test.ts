import { describe, expect, it, vi } from 'vitest';

import { ProjectMemoryScopeService } from '../../src/services/project-memory-scope-service.js';

describe('ProjectMemoryScopeService', () => {
  it('filters visible task memory to global and current workflow scope', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: 11,
            type: 'project.memory_updated',
            actor_type: 'agent',
            actor_id: 'agent:key',
            created_at: '2026-03-16T08:00:00.000Z',
            data: { key: 'global_note' },
          },
          {
            id: 12,
            type: 'project.memory_updated',
            actor_type: 'agent',
            actor_id: 'agent:key',
            created_at: '2026-03-16T08:01:00.000Z',
            data: { key: 'same_workflow', workflow_id: 'wf-1' },
          },
          {
            id: 13,
            type: 'project.memory_updated',
            actor_type: 'agent',
            actor_id: 'agent:key',
            created_at: '2026-03-16T08:02:00.000Z',
            data: { key: 'same_work_item', workflow_id: 'wf-1', work_item_id: 'wi-1' },
          },
          {
            id: 14,
            type: 'project.memory_updated',
            actor_type: 'agent',
            actor_id: 'agent:key',
            created_at: '2026-03-16T08:03:00.000Z',
            data: { key: 'other_workflow', workflow_id: 'wf-old' },
          },
          {
            id: 15,
            type: 'project.memory_updated',
            actor_type: 'agent',
            actor_id: 'agent:key',
            created_at: '2026-03-16T08:04:00.000Z',
            data: { key: 'other_work_item', workflow_id: 'wf-1', work_item_id: 'wi-2' },
          },
        ],
        rowCount: 5,
      }),
    };

    const service = new ProjectMemoryScopeService(pool as never);

    const visible = await service.filterVisibleTaskMemory({
      tenantId: 'tenant-1',
      projectId: 'project-1',
      workflowId: 'wf-1',
      workItemId: 'wi-1',
      currentMemory: {
        global_note: 'keep global',
        same_workflow: 'keep workflow',
        same_work_item: 'keep work item',
        other_workflow: 'hide old workflow',
        other_work_item: 'hide other item',
      },
    });

    expect(visible).toEqual({
      global_note: 'keep global',
      same_workflow: 'keep workflow',
      same_work_item: 'keep work item',
    });
  });

  it('lists recent visible task memory keys without unrelated workflow entries', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: 11,
            type: 'project.memory_updated',
            actor_type: 'agent',
            actor_id: 'agent:key',
            created_at: '2026-03-16T08:00:00.000Z',
            data: { key: 'global_note' },
          },
          {
            id: 12,
            type: 'project.memory_updated',
            actor_type: 'agent',
            actor_id: 'agent:key',
            created_at: '2026-03-16T08:01:00.000Z',
            data: { key: 'same_workflow', workflow_id: 'wf-1' },
          },
          {
            id: 13,
            type: 'project.memory_updated',
            actor_type: 'agent',
            actor_id: 'agent:key',
            created_at: '2026-03-16T08:02:00.000Z',
            data: { key: 'same_work_item', workflow_id: 'wf-1', work_item_id: 'wi-1' },
          },
          {
            id: 14,
            type: 'project.memory_updated',
            actor_type: 'agent',
            actor_id: 'agent:key',
            created_at: '2026-03-16T08:03:00.000Z',
            data: { key: 'other_workflow', workflow_id: 'wf-old' },
          },
        ],
        rowCount: 4,
      }),
    };

    const service = new ProjectMemoryScopeService(pool as never);

    const index = await service.listVisibleTaskMemoryKeys({
      tenantId: 'tenant-1',
      projectId: 'project-1',
      workflowId: 'wf-1',
      workItemId: 'wi-1',
      currentMemory: {
        global_note: 'keep global',
        same_workflow: 'keep workflow',
        same_work_item: 'keep work item',
        other_workflow: 'hide old workflow',
      },
      limit: 2,
    });

    expect(index).toEqual({
      keys: ['same_work_item', 'same_workflow'],
      total: 3,
      more_available: true,
    });
  });
});
