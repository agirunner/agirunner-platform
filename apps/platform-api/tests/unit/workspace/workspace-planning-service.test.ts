import { describe, expect, it, vi } from 'vitest';

import { NotFoundError } from '../../../src/errors/domain-errors.js';
import { WorkspacePlanningService } from '../../../src/services/workspace-planning-service.js';

describe('WorkspacePlanningService', () => {
  it('uses the workspace-configured planning playbook id when creating a planning workflow', async () => {
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT * FROM workspaces')) {
          expect(params).toEqual(['tenant-1', 'workspace-1']);
          return {
            rowCount: 1,
            rows: [{
              id: 'workspace-1',
              name: 'Alpha',
              settings: {
                planning_playbook_id: 'playbook-123',
              },
            }],
          };
        }
        if (sql.includes('SELECT id\n         FROM playbooks')) {
          expect(params).toEqual(['tenant-1', 'playbook-123']);
          return {
            rowCount: 1,
            rows: [{ id: 'playbook-123' }],
          };
        }
        if (sql.includes('UPDATE workspaces')) {
          expect(params?.[0]).toBe('tenant-1');
          expect(params?.[1]).toBe('workspace-1');
          expect(params?.[2]).toEqual(expect.objectContaining({
            workspace_brief: 'Plan the next release',
          }));
          return { rowCount: 1, rows: [] };
        }
        throw new Error(`Unexpected query: ${sql}`);
      }),
    };

    const workflowService = {
      createWorkflow: vi.fn(async () => ({ id: 'workflow-1' })),
    };

    const service = new WorkspacePlanningService(pool as never, workflowService as never);

    const result = await service.createPlanningWorkflow(
      {
        id: 'admin-key',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: 'user-1',
        keyPrefix: 'admin',
      },
      'workspace-1',
      {
        brief: 'Plan the next release',
        name: 'Release planning',
      },
    );

    expect(result).toEqual({ id: 'workflow-1' });
    expect(workflowService.createWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      expect.objectContaining({
        playbook_id: 'playbook-123',
        workspace_id: 'workspace-1',
        name: 'Release planning',
      }),
    );
  });

  it('fails closed when the workspace does not configure a planning playbook', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('SELECT * FROM workspaces')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workspace-1',
              name: 'Alpha',
              settings: {},
            }],
          };
        }
        throw new Error(`Unexpected query: ${sql}`);
      }),
    };

    const workflowService = {
      createWorkflow: vi.fn(),
    };

    const service = new WorkspacePlanningService(pool as never, workflowService as never);

    await expect(
      service.createPlanningWorkflow(
        {
          id: 'admin-key',
          tenantId: 'tenant-1',
          scope: 'admin',
          ownerType: 'user',
          ownerId: 'user-1',
          keyPrefix: 'admin',
        },
        'workspace-1',
        {
          brief: 'Plan the next release',
        },
      ),
    ).rejects.toThrow(NotFoundError);

    expect(workflowService.createWorkflow).not.toHaveBeenCalled();
  });
});
