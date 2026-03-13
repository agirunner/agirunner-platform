import { describe, expect, it, vi } from 'vitest';

import { ProjectArtifactExplorerService } from '../../src/services/project-artifact-explorer-service.js';

describe('ProjectArtifactExplorerService', () => {
  it('returns bounded project artifact rows with summary and filter options', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{
            total_artifacts: 2,
            previewable_artifacts: 1,
            total_bytes: 3072,
            workflow_count: 1,
            work_item_count: 1,
            task_count: 2,
            role_count: 1,
            workflows: [{ id: 'wf-1', name: 'Release board' }],
            work_items: [{
              id: 'wi-1',
              title: 'Prepare release packet',
              workflow_id: 'wf-1',
              stage_name: 'delivery',
            }],
            tasks: [{
              id: 'task-1',
              title: 'Build release notes',
              workflow_id: 'wf-1',
              work_item_id: 'wi-1',
              stage_name: 'delivery',
            }],
            stages: ['delivery'],
            roles: ['writer'],
            content_types: ['text/markdown'],
          }],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{
            id: 'artifact-1',
            workflow_id: 'wf-1',
            task_id: 'task-1',
            logical_path: 'artifact:wf-1/release-notes.md',
            content_type: 'text/markdown',
            size_bytes: 2048,
            metadata: { audience: 'operators', api_key: 'plain-secret' },
            created_at: new Date('2026-03-12T11:00:00.000Z'),
            workflow_name: 'Release board',
            workflow_state: 'active',
            work_item_id: 'wi-1',
            work_item_title: 'Prepare release packet',
            stage_name: 'delivery',
            role: 'writer',
            task_title: 'Build release notes',
            task_state: 'completed',
          }],
        }),
    };

    const service = new ProjectArtifactExplorerService(pool as never, 1024 * 1024);

    const result = await service.listProjectArtifacts('tenant-1', 'project-1', {
      q: 'release',
      preview_mode: 'inline',
      sort: 'newest',
      page: 1,
      per_page: 50,
    });

    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(result.meta).toEqual({
      page: 1,
      per_page: 50,
      total: 2,
      total_pages: 1,
      has_more: false,
      summary: {
        total_artifacts: 2,
        previewable_artifacts: 1,
        total_bytes: 3072,
        workflow_count: 1,
        work_item_count: 1,
        task_count: 2,
        role_count: 1,
      },
      filters: {
        workflows: [{ id: 'wf-1', name: 'Release board' }],
        work_items: [{
          id: 'wi-1',
          title: 'Prepare release packet',
          workflow_id: 'wf-1',
          stage_name: 'delivery',
        }],
        tasks: [{
          id: 'task-1',
          title: 'Build release notes',
          workflow_id: 'wf-1',
          work_item_id: 'wi-1',
          stage_name: 'delivery',
        }],
        stages: ['delivery'],
        roles: ['writer'],
        content_types: ['text/markdown'],
      },
    });
    expect(result.data).toEqual([{
      id: 'artifact-1',
      workflow_id: 'wf-1',
      task_id: 'task-1',
      logical_path: 'artifact:wf-1/release-notes.md',
      content_type: 'text/markdown',
      size_bytes: 2048,
      created_at: '2026-03-12T11:00:00.000Z',
      download_url: '/api/v1/tasks/task-1/artifacts/artifact-1',
      metadata: {
        audience: 'operators',
        api_key: 'redacted://artifact-metadata-secret',
      },
      workflow_name: 'Release board',
      workflow_state: 'active',
      work_item_id: 'wi-1',
      work_item_title: 'Prepare release packet',
      stage_name: 'delivery',
      role: 'writer',
      task_title: 'Build release notes',
      task_state: 'completed',
      preview_eligible: true,
      preview_mode: 'text',
    }]);
  });

  it('rejects inverted created date bounds', async () => {
    const service = new ProjectArtifactExplorerService({ query: vi.fn() } as never, 1024);

    await expect(
      service.listProjectArtifacts('tenant-1', 'project-1', {
        created_from: '2026-03-12',
        created_to: '2026-03-11',
        page: 1,
        per_page: 20,
      }),
    ).rejects.toThrow('created_from must be on or before created_to');
  });
});
