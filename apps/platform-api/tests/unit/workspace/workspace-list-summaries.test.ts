import { describe, expect, it, vi } from 'vitest';

import { WorkspaceService } from '../../../src/services/workspace/workspace-service.js';
import { createEventService } from './workspace-test-helpers.js';

describe('WorkspaceService workspace list summaries', () => {
  it('returns workflow summary counts with a single aggregate query for the page', async () => {
    const workflowSummaryQueries: Array<unknown[] | undefined> = [];
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.startsWith('SELECT COUNT(*)::int AS total FROM workspaces')) {
          return {
            rowCount: 1,
            rows: [{ total: 2 }],
          };
        }

        if (sql.startsWith('SELECT * FROM workspaces')) {
          return {
            rowCount: 2,
            rows: [
              {
                id: '11111111-1111-1111-1111-111111111111',
                tenant_id: 'tenant-1',
                name: 'Alpha',
                slug: 'alpha',
                description: null,
                repository_url: null,
                settings: {},
                memory: {},
                git_webhook_secret: null,
                is_active: true,
              },
              {
                id: '22222222-2222-2222-2222-222222222222',
                tenant_id: 'tenant-1',
                name: 'Beta',
                slug: 'beta',
                description: null,
                repository_url: null,
                settings: {},
                memory: {},
                git_webhook_secret: null,
                is_active: true,
              },
            ],
          };
        }

        if (sql.includes('FROM workflows') && sql.includes('GROUP BY workspace_id')) {
          workflowSummaryQueries.push(values);
          return {
            rowCount: 1,
            rows: [
              {
                workspace_id: '11111111-1111-1111-1111-111111111111',
                active_workflow_count: 1,
                completed_workflow_count: 4,
                attention_workflow_count: 2,
                total_workflow_count: 7,
                last_workflow_activity_at: '2026-03-14T10:15:00.000Z',
              },
            ],
          };
        }

        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const service = new WorkspaceService(pool as never, createEventService() as never);

    const result = await service.listWorkspaces('tenant-1', {
      page: 1,
      per_page: 50,
    });

    expect(workflowSummaryQueries).toEqual([
      [
        'tenant-1',
        [
          '11111111-1111-1111-1111-111111111111',
          '22222222-2222-2222-2222-222222222222',
        ],
      ],
    ]);
    expect(result.data).toEqual([
      expect.objectContaining({
        id: '11111111-1111-1111-1111-111111111111',
        name: 'Alpha',
        summary: {
          active_workflow_count: 1,
          completed_workflow_count: 4,
          attention_workflow_count: 2,
          total_workflow_count: 7,
          last_workflow_activity_at: '2026-03-14T10:15:00.000Z',
        },
      }),
      expect.objectContaining({
        id: '22222222-2222-2222-2222-222222222222',
        name: 'Beta',
        summary: {
          active_workflow_count: 0,
          completed_workflow_count: 0,
          attention_workflow_count: 0,
          total_workflow_count: 0,
          last_workflow_activity_at: null,
        },
      }),
    ]);
    expect(result.meta).toEqual({
      total: 2,
      page: 1,
      per_page: 50,
      pages: 1,
    });
  });
});
