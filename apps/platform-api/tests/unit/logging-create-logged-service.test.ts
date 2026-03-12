import { describe, expect, it, vi } from 'vitest';

import { createLoggedService, methodToAction } from '../../src/logging/create-logged-service.js';

describe('methodToAction', () => {
  it('convertsCreatePrefix', () => {
    expect(methodToAction('createProject')).toBe('created');
  });

  it('convertsUpdatePrefix', () => {
    expect(methodToAction('updateProject')).toBe('updated');
  });

  it('convertsDeletePrefix', () => {
    expect(methodToAction('deleteUser')).toBe('deleted');
  });

  it('convertsCancelPrefix', () => {
    expect(methodToAction('cancelWorkflow')).toBe('canceled');
  });

  it('convertsClaimPrefix', () => {
    expect(methodToAction('claimTask')).toBe('claimed');
  });

  it('convertsApprovePrefix', () => {
    expect(methodToAction('approveTask')).toBe('approved');
  });

  it('convertsPausePrefix', () => {
    expect(methodToAction('pauseWorkflow')).toBe('paused');
  });

  it('convertsResumePrefix', () => {
    expect(methodToAction('resumeWorkflow')).toBe('resumed');
  });

  it('convertsRevokePrefix', () => {
    expect(methodToAction('revokeApiKey')).toBe('revoked');
  });

  it('fallsBackToMethodNameForUnknownPrefix', () => {
    expect(methodToAction('doSomething')).toBe('doSomething');
  });
});

describe('createLoggedService', () => {
  it('returnsServiceUnwrappedWhenNotInRegistry', () => {
    const service = { doWork: vi.fn() };
    const logService = { insert: vi.fn().mockResolvedValue(undefined) };
    const wrapped = createLoggedService(service, 'UnknownService', logService as never);
    expect(wrapped).toBe(service);
  });

  it('proxiesMutationMethodsAndLogsSuccessfully', async () => {
    const service = {
      createSomething: vi.fn().mockResolvedValue({ id: 'proj-1', name: 'Test Project' }),
      getProject: vi.fn().mockResolvedValue({ id: 'proj-1' }),
    };
    const logInsert = vi.fn().mockResolvedValue(undefined);
    const logService = { insert: logInsert };

    const wrapped = createLoggedService(service, 'ProjectService', logService as never);

    const result = await wrapped.createSomething({ name: 'Test Project' });
    expect(result).toEqual({ id: 'proj-1', name: 'Test Project' });

    // Allow async fire-and-forget to complete
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(logInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'platform',
        category: 'config',
        level: 'info',
        status: 'completed',
        operation: 'config.project.created',
        resourceType: 'project',
        resourceId: 'proj-1',
        resourceName: 'Test Project',
      }),
    );
  });

  it('skipsLoggingForIgnoredMethods', async () => {
    const service = {
      getProject: vi.fn().mockResolvedValue({ id: 'proj-1' }),
    };
    const logInsert = vi.fn().mockResolvedValue(undefined);
    const logService = { insert: logInsert };

    const wrapped = createLoggedService(service, 'ProjectService', logService as never);
    await wrapped.getProject('proj-1');

    expect(logInsert).not.toHaveBeenCalled();
  });

  it('logsFailedMutationsWithErrorLevel', async () => {
    const error = new Error('Database connection lost');
    const service = {
      createProject: vi.fn().mockRejectedValue(error),
    };
    const logInsert = vi.fn().mockResolvedValue(undefined);
    const logService = { insert: logInsert };

    const wrapped = createLoggedService(service, 'ProjectService', logService as never);

    await expect(wrapped.createProject({ name: 'Test' })).rejects.toThrow(
      'Database connection lost',
    );

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(logInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        status: 'failed',
        operation: 'config.project.created',
        error: expect.objectContaining({ message: 'Database connection lost' }),
      }),
    );
  });

  it('passesNonFunctionPropertiesThrough', () => {
    const service = {
      pool: { query: vi.fn() },
      listProjects: vi.fn(),
    };
    const logService = { insert: vi.fn().mockResolvedValue(undefined) };

    const wrapped = createLoggedService(service, 'ProjectService', logService as never);
    expect(wrapped.pool).toBe(service.pool);
  });

  it('skipsPrivateMethodsStartingWithUnderscore', async () => {
    const service = {
      _internalHelper: vi.fn().mockResolvedValue('result'),
    };
    const logInsert = vi.fn().mockResolvedValue(undefined);
    const logService = { insert: logInsert };

    const wrapped = createLoggedService(service, 'ProjectService', logService as never);
    const result = await wrapped._internalHelper();

    expect(result).toBe('result');
    expect(logInsert).not.toHaveBeenCalled();
  });

  it('usesCanonicalStageContextOnly', async () => {
    const service = {
      createTask: vi.fn().mockResolvedValue({
        id: 'task-1',
        title: 'Implement feature',
        workflowId: 'workflow-1',
        workItemId: 'work-item-1',
        stageName: 'implementation',
      }),
    };
    const logInsert = vi.fn().mockResolvedValue(undefined);
    const logService = { insert: logInsert };

    const wrapped = createLoggedService(service, 'TaskService', logService as never);
    await wrapped.createTask({ workflowId: 'workflow-1', stageName: 'implementation' });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(logInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'workflow-1',
        workItemId: 'work-item-1',
        stageName: 'implementation',
      }),
    );
    expect(logInsert.mock.calls[0][0].stageName).toBe('implementation');
  });
});
