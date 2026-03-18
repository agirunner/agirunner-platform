import { describe, expect, it, vi } from 'vitest';

import { createLoggedService, methodToAction } from '../../src/logging/create-logged-service.js';

describe('methodToAction', () => {
  it('convertsCreatePrefix', () => {
    expect(methodToAction('createWorkspace')).toBe('created');
  });

  it('convertsUpdatePrefix', () => {
    expect(methodToAction('updateWorkspace')).toBe('updated');
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

  it('convertsReplacePrefix', () => {
    expect(methodToAction('replacePlaybook')).toBe('replaced');
  });

  it('convertsUpsertPrefix', () => {
    expect(methodToAction('upsertDefault')).toBe('upserted');
  });

  it('convertsUploadPrefix', () => {
    expect(methodToAction('uploadWorkspaceArtifactFile')).toBe('uploaded');
  });

  it('convertsEnqueuePrefix', () => {
    expect(methodToAction('enqueue')).toBe('enqueued');
  });

  it('convertsOverridePrefix', () => {
    expect(methodToAction('overrideTaskOutput')).toBe('overrode');
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
      getWorkspace: vi.fn().mockResolvedValue({ id: 'proj-1' }),
    };
    const logInsert = vi.fn().mockResolvedValue(undefined);
    const logService = { insert: logInsert };

    const wrapped = createLoggedService(service, 'WorkspaceService', logService as never);

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
        operation: 'config.workspace.created',
        resourceType: 'workspace',
        resourceId: 'proj-1',
        resourceName: 'Test Project',
      }),
    );
  });

  it('skipsLoggingForIgnoredMethods', async () => {
    const service = {
      getWorkspace: vi.fn().mockResolvedValue({ id: 'proj-1' }),
    };
    const logInsert = vi.fn().mockResolvedValue(undefined);
    const logService = { insert: logInsert };

    const wrapped = createLoggedService(service, 'WorkspaceService', logService as never);
    await wrapped.getWorkspace('proj-1');

    expect(logInsert).not.toHaveBeenCalled();
  });

  it('logsFailedMutationsWithErrorLevel', async () => {
    const error = new Error('Database connection lost');
    const service = {
      createWorkspace: vi.fn().mockRejectedValue(error),
    };
    const logInsert = vi.fn().mockResolvedValue(undefined);
    const logService = { insert: logInsert };

    const wrapped = createLoggedService(service, 'WorkspaceService', logService as never);

    await expect(wrapped.createWorkspace({ name: 'Test' })).rejects.toThrow(
      'Database connection lost',
    );

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(logInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        status: 'failed',
        operation: 'config.workspace.created',
        error: expect.objectContaining({ message: 'Database connection lost' }),
      }),
    );
  });

  it('passesNonFunctionPropertiesThrough', () => {
    const service = {
      pool: { query: vi.fn() },
      listWorkspaces: vi.fn(),
    };
    const logService = { insert: vi.fn().mockResolvedValue(undefined) };

    const wrapped = createLoggedService(service, 'WorkspaceService', logService as never);
    expect(wrapped.pool).toBe(service.pool);
  });

  it('skipsPrivateMethodsStartingWithUnderscore', async () => {
    const service = {
      _internalHelper: vi.fn().mockResolvedValue('result'),
    };
    const logInsert = vi.fn().mockResolvedValue(undefined);
    const logService = { insert: logInsert };

    const wrapped = createLoggedService(service, 'WorkspaceService', logService as never);
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

  it('logsFailedTaskMutationsWithTaskContextAndRequestId', async () => {
    const error = new Error('invalid input value for enum task_state: "paused"');
    const service = {
      createTask: vi.fn().mockRejectedValue(error),
    };
    const logInsert = vi.fn().mockResolvedValue(undefined);
    const logService = { insert: logInsert };

    const wrapped = createLoggedService(service, 'TaskService', logService as never);

    await expect(
      wrapped.createTask({
        request_id: 'req-task-create-1',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        stage_name: 'requirements',
        role: 'product-manager',
      }),
    ).rejects.toThrow('invalid input value for enum task_state: "paused"');

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(logInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        status: 'failed',
        workflowId: 'workflow-1',
        workItemId: 'work-item-1',
        stageName: 'requirements',
        role: 'product-manager',
        payload: expect.objectContaining({
          method: 'createTask',
          request_id: 'req-task-create-1',
          error_message: 'invalid input value for enum task_state: "paused"',
        }),
      }),
    );
  });

  it('logsReplacePrefixMethodsForPlaybooks', async () => {
    const service = {
      replacePlaybook: vi.fn().mockResolvedValue({ id: 'playbook-1', name: 'Workspace Planning' }),
    };
    const logInsert = vi.fn().mockResolvedValue(undefined);
    const logService = { insert: logInsert };

    const wrapped = createLoggedService(service, 'PlaybookService', logService as never);
    await wrapped.replacePlaybook('tenant-1', 'playbook-1', { name: 'Workspace Planning' });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(logInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'config.playbook.replaced',
        resourceType: 'playbook',
        resourceId: 'playbook-1',
        resourceName: 'Workspace Planning',
      }),
    );
  });

  it('logsEnqueueMethodsForWorkflowActivations', async () => {
    const service = {
      enqueue: vi.fn().mockResolvedValue({
        id: 'activation-row-1',
        activation_id: 'activation-1',
      }),
    };
    const logInsert = vi.fn().mockResolvedValue(undefined);
    const logService = { insert: logInsert };

    const wrapped = createLoggedService(service, 'WorkflowActivationService', logService as never);
    await wrapped.enqueue({ tenantId: 'tenant-1' }, 'workflow-1', {
      request_id: 'req-activation-1',
      reason: 'manual recheck',
      event_type: 'workflow.manual',
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(logInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'task_lifecycle.workflow_activation.enqueued',
        resourceType: 'workflow_activation',
        resourceId: 'activation-row-1',
      }),
    );
  });
});
