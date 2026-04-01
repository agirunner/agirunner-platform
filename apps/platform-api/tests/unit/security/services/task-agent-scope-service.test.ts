import { describe, expect, it, vi } from 'vitest';

import { ForbiddenError } from '../../../../src/errors/domain-errors.js';
import { TaskAgentScopeService } from '../../../../src/services/task/task-agent-scope-service.js';

describe('TaskAgentScopeService', () => {
  it('allows worker identities to load worker-owned active tasks', async () => {
    const pool = {
      query: vi.fn(async () => ({
        rowCount: 1,
        rows: [{
          id: 'task-1',
          workflow_id: 'workflow-1',
          workspace_id: 'workspace-1',
          work_item_id: 'wi-1',
          stage_name: 'implementation',
          activation_id: 'activation-1',
          assigned_agent_id: 'agent-1',
          is_orchestrator_task: true,
          state: 'claimed',
          assigned_worker_id: 'worker-1',
        }],
      })),
    };

    const service = new TaskAgentScopeService(pool as never);
    const scope = await service.loadAgentOwnedActiveTask(
      {
        id: 'key-1',
        tenantId: 'tenant-1',
        scope: 'worker',
        ownerType: 'worker',
        ownerId: 'worker-1',
        keyPrefix: 'worker-1',
      },
      'task-1',
    );

    expect(scope.state).toBe('claimed');
  });

  it('keeps canonical in-progress tasks active for task-scoped tools', async () => {
    const pool = {
      query: vi.fn(async () => ({
        rowCount: 1,
        rows: [{
          id: 'task-1',
          workflow_id: 'workflow-1',
          workspace_id: 'workspace-1',
          work_item_id: 'wi-1',
          stage_name: 'implementation',
          activation_id: 'activation-1',
          assigned_agent_id: 'agent-1',
          is_orchestrator_task: false,
          state: 'in_progress',
          assigned_worker_id: null,
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
          workspace_id: 'workspace-1',
          work_item_id: 'wi-1',
          stage_name: 'implementation',
          activation_id: 'activation-1',
          assigned_agent_id: 'agent-1',
          is_orchestrator_task: false,
          state: 'running',
          assigned_worker_id: null,
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

  it('returns an explicit stale callback disposition when task ownership has moved', async () => {
    const pool = {
      query: vi.fn(async () => ({
        rowCount: 1,
        rows: [{
          id: 'task-1',
          workflow_id: 'workflow-1',
          workspace_id: 'workspace-1',
          work_item_id: 'wi-1',
          stage_name: 'implementation',
          activation_id: 'activation-1',
          assigned_agent_id: 'agent-2',
          is_orchestrator_task: false,
          state: 'in_progress',
          assigned_worker_id: null,
        }],
      })),
    };

    const service = new TaskAgentScopeService(pool as never);

    const error = await service.loadAgentOwnedActiveTask(
      {
        id: 'key-1',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'agent-1',
      },
      'task-1',
    ).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error).toMatchObject({
      code: 'FORBIDDEN',
      details: {
        reason_code: 'task_ownership_moved',
        stale_callback_disposition: 'superseded',
      },
    });
  });
});
