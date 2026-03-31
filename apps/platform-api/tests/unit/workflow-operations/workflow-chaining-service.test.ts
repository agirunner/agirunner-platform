import { describe, expect, it, vi } from 'vitest';

const { logSafetynetTriggeredMock } = vi.hoisted(() => ({
  logSafetynetTriggeredMock: vi.fn(),
}));

vi.mock('../../../src/services/safetynet/logging.js', () => ({
  logSafetynetTriggered: logSafetynetTriggeredMock,
}));

import { WorkflowChainingService } from '../../../src/services/workflow-operations/workflow-chaining-service.js';

describe('WorkflowChainingService', () => {
  it('reads source workflows through an explicit v2 projection instead of wildcard selection', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM workflows WHERE tenant_id = $1 AND id = $2')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'workflow-1',
            workspace_id: 'workspace-1',
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
      'SELECT id, workspace_id, name, state, metadata FROM workflows WHERE tenant_id = $1 AND id = $2',
    );
    expect(String(query.mock.calls[0]?.[0] ?? '')).not.toContain('*');
    expect(workflowService.createWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      expect.objectContaining({
        playbook_id: 'playbook-2',
        workspace_id: 'workspace-1',
        metadata: expect.objectContaining({
          parent_workflow_id: 'workflow-1',
          chain_origin: 'explicit',
        }),
      }),
    );
  });

  it('logs when an explicit chained workflow request reuses the stored child workflow', async () => {
    logSafetynetTriggeredMock.mockReset();
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM workflows WHERE tenant_id = $1 AND id = $2')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'workflow-1',
            workspace_id: 'workspace-1',
            name: 'Source workflow',
            state: 'active',
            metadata: {},
          }],
        };
      }
      if (sql.includes("metadata->>'parent_workflow_id' = $2")) {
        expect(params).toEqual(['tenant-1', 'workflow-1', 'req-1']);
        return {
          rowCount: 1,
          rows: [{ id: 'workflow-child-1' }],
        };
      }
      if (sql.startsWith('UPDATE workflows')) {
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const workflowService = {
      createWorkflow: vi.fn(async () => {
        throw new Error('createWorkflow should not run when replayed child workflow already exists');
      }),
      getWorkflow: vi.fn(async () => ({ id: 'workflow-child-1' })),
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
        request_id: 'req-1',
        playbook_id: 'playbook-2',
        name: 'Follow-up',
      },
    );

    expect(result).toEqual({ id: 'workflow-child-1' });
    expect(logSafetynetTriggeredMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'platform.control_plane.idempotent_mutation_replay',
      }),
      'idempotent chained workflow request returned stored workflow',
      expect.objectContaining({
        workflow_id: 'workflow-1',
        request_id: 'req-1',
      }),
    );
  });
});
