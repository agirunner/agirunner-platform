import { describe, expect, it, vi } from 'vitest';

import { WorkflowChainingService } from '../../src/services/workflow-chaining-service.js';

describe('WorkflowChainingService', () => {
  it('reads source workflows through an explicit v2 projection instead of wildcard selection', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM workflows WHERE tenant_id = $1 AND id = $2')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'workflow-1',
            project_id: 'project-1',
            name: 'Source workflow',
            state: 'active',
            metadata: {},
          }],
        };
      }
      if (sql.startsWith('UPDATE workflows')) {
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const workflowService = {
      createWorkflow: vi.fn(async () => ({ id: 'workflow-child-1' })),
      getWorkflow: vi.fn(),
    };

    const service = new WorkflowChainingService({ query } as never, workflowService as never);

    const result = await service.chainWorkflowExplicit(
      {
        tenantId: 'tenant-1',
        scope: 'admin',
        keyPrefix: 'admin',
      } as never,
      'workflow-1',
      {
        playbook_id: 'playbook-2',
        name: 'Follow-up',
      },
    );

    expect(result).toEqual({ id: 'workflow-child-1' });
    expect(String(query.mock.calls[0]?.[0] ?? '')).toBe(
      'SELECT id, project_id, name, state, metadata FROM workflows WHERE tenant_id = $1 AND id = $2',
    );
    expect(String(query.mock.calls[0]?.[0] ?? '')).not.toContain('*');
    expect(workflowService.createWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      expect.objectContaining({
        playbook_id: 'playbook-2',
        project_id: 'project-1',
        metadata: expect.objectContaining({
          parent_workflow_id: 'workflow-1',
          chain_origin: 'explicit',
        }),
      }),
    );
  });
});
