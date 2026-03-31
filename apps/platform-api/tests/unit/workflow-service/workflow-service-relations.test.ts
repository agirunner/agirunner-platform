import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkflowService } from '../../../src/services/workflow-service/workflow-service.js';

describe('WorkflowService workflow relations', () => {
  const artifactLocalRoot = resolve('tmp');

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hydrates child workflow status visibility on workflow lists', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ total: '1' }] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'wf-1',
              tenant_id: 'tenant-1',
              name: 'Parent workflow',
              state: 'active',
              metadata: {
                parent_workflow_id: null,
                child_workflow_ids: ['wf-child-1', 'wf-child-2'],
                latest_child_workflow_id: 'wf-child-2',
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'wf-child-1',
              name: 'Child A',
              state: 'completed',
              playbook_id: 'pb-1',
              playbook_name: 'SDLC',
              created_at: '2026-03-10T00:00:00.000Z',
              started_at: null,
              completed_at: '2026-03-10T01:00:00.000Z',
            },
            {
              id: 'wf-child-2',
              name: 'Child B',
              state: 'failed',
              playbook_id: 'pb-1',
              playbook_name: 'SDLC',
              created_at: '2026-03-10T00:30:00.000Z',
              started_at: null,
              completed_at: '2026-03-10T01:30:00.000Z',
            },
          ],
        }),
    };
    const service = new WorkflowService(
      pool as never,
      { emit: vi.fn() } as never,
      { TASK_DEFAULT_TIMEOUT_MINUTES: 30, ARTIFACT_STORAGE_BACKEND: 'local', ARTIFACT_LOCAL_ROOT: artifactLocalRoot } as never,
    );

    const result = await service.listWorkflows('tenant-1', { page: 1, per_page: 20 });

    expect(result.data[0].workflow_relations).toEqual({
      parent: null,
      children: [
        expect.objectContaining({ workflow_id: 'wf-child-1', state: 'completed', is_terminal: true }),
        expect.objectContaining({ workflow_id: 'wf-child-2', state: 'failed', is_terminal: true }),
      ],
      latest_child_workflow_id: 'wf-child-2',
      child_status_counts: {
        total: 2,
        active: 0,
        completed: 1,
        failed: 1,
        cancelled: 0,
      },
    });
  });
});
