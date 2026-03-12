import { describe, expect, it, vi } from 'vitest';

import { TaskAgentScopeService } from '../../src/services/task-agent-scope-service.js';

describe('TaskAgentScopeService', () => {
  it('keeps canonical in-progress tasks active for task-scoped tools', async () => {
    const pool = {
      query: vi.fn(async () => ({
        rowCount: 1,
        rows: [{
          id: 'task-1',
          workflow_id: 'workflow-1',
          project_id: 'project-1',
          work_item_id: 'wi-1',
          stage_name: 'implementation',
          activation_id: 'activation-1',
          assigned_agent_id: 'agent-1',
          is_orchestrator_task: false,
          state: 'in_progress',
        }],
      })),
    };

    const service = new TaskAgentScopeService(pool as never);
    const scope = await service.loadAgentOwnedActiveTask(
      {
        id: 'key-1',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'agent-1',
      },
      'task-1',
    );

    expect(scope.state).toBe('in_progress');
  });

  it('rejects legacy alias states at the live service boundary', async () => {
    const pool = {
      query: vi.fn(async () => ({
        rowCount: 1,
        rows: [{
          id: 'task-1',
          workflow_id: 'workflow-1',
          project_id: 'project-1',
          work_item_id: 'wi-1',
          stage_name: 'implementation',
          activation_id: 'activation-1',
          assigned_agent_id: 'agent-1',
          is_orchestrator_task: false,
          state: 'running',
        }],
      })),
    };

    const service = new TaskAgentScopeService(pool as never);

    await expect(
      service.loadAgentOwnedActiveTask(
        {
          id: 'key-1',
          tenantId: 'tenant-1',
          scope: 'agent',
          ownerType: 'agent',
          ownerId: 'agent-1',
          keyPrefix: 'agent-1',
        },
        'task-1',
      ),
    ).rejects.toThrow('Task-scoped tools require an active task');
  });
});
