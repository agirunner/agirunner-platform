import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LogService } from '../../../../../src/logging/execution/log-service.js';
import { createLoggedService } from '../../../../../src/logging/execution/create-logged-service.js';
import { createMockPool } from './support.js';

describe('Logging E2E Verification - service proxy', () => {
  let pool: ReturnType<typeof createMockPool>;
  let logService: LogService;

  beforeEach(() => {
    pool = createMockPool();
    logService = new LogService(pool as never);
  });

  it('workspaceServiceCreateGeneratesConfigLog', async () => {
    const service = {
      createWorkspace: vi
        .fn()
        .mockResolvedValue({
          id: '00000000-0000-0000-0000-000000000101',
          name: 'My Workspace',
          status: 'active',
        }),
    };
    const wrapped = createLoggedService(service, 'WorkspaceService', logService);

    await wrapped.createWorkspace({ name: 'My Workspace' });
    await vi.waitFor(() => expect(pool.rows.length).toBeGreaterThan(0));

    const logRow = pool.rows[0];
    expect(logRow.source).toBe('platform');
    expect(logRow.category).toBe('config');
    expect(logRow.operation).toBe('config.workspace.created');
    expect(logRow.status).toBe('completed');
    expect(logRow.resource_type).toBe('workspace');
    expect(logRow.resource_id).toBe('00000000-0000-0000-0000-000000000101');
    expect(logRow.resource_name).toBe('My Workspace');
  });

  it('taskServiceCreateGeneratesLifecycleLog', async () => {
    const service = {
      createTask: vi
        .fn()
        .mockResolvedValue({
          id: '00000000-0000-0000-0000-000000000102',
          title: 'Fix bug',
          workflow_id: 'wf-1',
        }),
    };
    const wrapped = createLoggedService(service, 'TaskService', logService);

    await wrapped.createTask({ title: 'Fix bug' });
    await vi.waitFor(() => expect(pool.rows.length).toBeGreaterThan(0));

    const logRow = pool.rows[0];
    expect(logRow.category).toBe('task_lifecycle');
    expect(logRow.operation).toBe('task_lifecycle.task.created');
    expect(logRow.resource_type).toBe('task');
    expect(logRow.resource_id).toBe('00000000-0000-0000-0000-000000000102');
    expect(logRow.resource_name).toBe('Fix bug');
  });

  it('apiKeyServiceRevokeGeneratesAuthLog', async () => {
    const service = {
      revokeApiKey: vi.fn().mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000103',
        label: 'CI Key',
        revoked: true,
      }),
    };
    const wrapped = createLoggedService(service, 'ApiKeyService', logService);

    await wrapped.revokeApiKey('key-1');
    await vi.waitFor(() => expect(pool.rows.length).toBeGreaterThan(0));

    const logRow = pool.rows[0];
    expect(logRow.category).toBe('auth');
    expect(logRow.operation).toBe('auth.api_key.revoked');
    expect(logRow.resource_type).toBe('api_key');
    expect(logRow.resource_id).toBe('00000000-0000-0000-0000-000000000103');
  });

  it('fleetServiceDrainGeneratesContainerLog', async () => {
    const service = {
      drainRuntime: vi
        .fn()
        .mockResolvedValue({ id: 'rt-1', name: 'runtime-01', status: 'draining' }),
    };
    const wrapped = createLoggedService(service, 'FleetService', logService);

    await wrapped.drainRuntime('rt-1');
    await vi.waitFor(() => expect(pool.rows.length).toBeGreaterThan(0));

    const logRow = pool.rows[0];
    expect(logRow.category).toBe('container');
    expect(logRow.operation).toBe('container.infrastructure.drained');
  });

  it('failedMutationLogsErrorWithCorrectFields', async () => {
    const service = {
      createWorkspace: vi.fn().mockRejectedValue(new Error('unique constraint violation')),
    };
    const wrapped = createLoggedService(service, 'WorkspaceService', logService);

    await expect(wrapped.createWorkspace({ name: 'Dup' })).rejects.toThrow();
    await vi.waitFor(() => expect(pool.rows.length).toBeGreaterThan(0));

    const logRow = pool.rows[0];
    expect(logRow.level).toBe('error');
    expect(logRow.status).toBe('failed');
    expect(logRow.error).toEqual(
      expect.objectContaining({ message: 'unique constraint violation' }),
    );
    expect(logRow.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('durationMsIsCapturedOnSuccess', async () => {
    const performanceNow = vi.spyOn(performance, 'now');
    performanceNow.mockReturnValueOnce(100).mockReturnValueOnce(112);
    const service = {
      createWorkflow: vi.fn().mockResolvedValue({ id: 'wf-1', name: 'Build Pipeline' }),
    };
    const wrapped = createLoggedService(service, 'WorkflowService', logService);

    await wrapped.createWorkflow({ name: 'Build Pipeline' });
    await vi.waitFor(() => expect(pool.rows.length).toBeGreaterThan(0));

    const logRow = pool.rows[0];
    expect(logRow.duration_ms).toBe(12);
  });

  it('ignoredMethodsDoNotProduceLogs', async () => {
    const service = {
      getWorkspace: vi.fn().mockResolvedValue({ id: 'proj-1' }),
      listWorkspaces: vi.fn().mockResolvedValue([]),
    };
    const wrapped = createLoggedService(service, 'WorkspaceService', logService);

    await wrapped.getWorkspace('proj-1');
    await wrapped.listWorkspaces();
    await new Promise((r) => setTimeout(r, 20));

    expect(pool.rows).toHaveLength(0);
  });

  it('nonMutationPrefixMethodsDoNotProduceLogs', async () => {
    const service = {
      getWorkspace: vi.fn().mockResolvedValue({ id: 'proj-1' }),
      validateSomething: vi.fn().mockResolvedValue(true),
    };
    const wrapped = createLoggedService(service, 'WorkspaceService', logService);

    await wrapped.validateSomething();
    await new Promise((r) => setTimeout(r, 20));

    expect(pool.rows).toHaveLength(0);
  });
});
