import { describe, expect, it, vi } from 'vitest';

import { ValidationError } from '../../../../src/errors/domain-errors.js';
import { createLoggedService, methodToAction } from '../../../../src/logging/execution/create-logged-service.js';

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

  it('convertsExactAcknowledgedMethodOverrides', () => {
    expect(methodToAction('acknowledgeSignal')).toBe('acknowledged');
  });

  it('convertsExactInvokeMethodOverrides', () => {
    expect(methodToAction('invokeTrigger')).toBe('invoked');
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
      createSomething: vi.fn().mockResolvedValue({ id: 'proj-1', name: 'Test Workspace' }),
      getWorkspace: vi.fn().mockResolvedValue({ id: 'proj-1' }),
    };
    const logInsert = vi.fn().mockResolvedValue(undefined);
    const logService = { insert: logInsert };

    const wrapped = createLoggedService(service, 'WorkspaceService', logService as never);

    const result = await wrapped.createSomething({ name: 'Test Workspace' });
    expect(result).toEqual({ id: 'proj-1', name: 'Test Workspace' });

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
        resourceName: 'Test Workspace',
      }),
    );
  });

  it('logs routine worker acknowledgements at debug', async () => {
    const service = {
      acknowledgeTask: vi.fn().mockResolvedValue({ id: 'worker-1', name: 'worker-1' }),
    };
    const logInsert = vi.fn().mockResolvedValue(undefined);
    const logService = { insert: logInsert };

    const wrapped = createLoggedService(service, 'WorkerService', logService as never);

    await wrapped.acknowledgeTask('task-1');
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(logInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'container',
        level: 'debug',
        operation: 'container.worker.acknowledged',
      }),
    );
  });

  it('logs successful api-category service mutations at debug', async () => {
    const service = {
      registerAgent: vi.fn().mockResolvedValue({ id: 'agent-1', name: 'Draft reviewer' }),
    };
    const logInsert = vi.fn().mockResolvedValue(undefined);
    const logService = { insert: logInsert };

    const wrapped = createLoggedService(service, 'AgentService', logService as never);

    await wrapped.registerAgent({ name: 'Draft reviewer' });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(logInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'api',
        level: 'debug',
        operation: 'api.agent.registered',
      }),
    );
  });

  it('logs successful task escalations at warn', async () => {
    const service = {
      escalateTask: vi.fn().mockResolvedValue({ id: 'task-1', title: 'Needs help' }),
    };
    const logInsert = vi.fn().mockResolvedValue(undefined);
    const logService = { insert: logInsert };

    const wrapped = createLoggedService(service, 'TaskService', logService as never);

    await wrapped.escalateTask('task-1', { reason: 'Need operator guidance' });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(logInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'task_lifecycle',
        level: 'warn',
        status: 'completed',
        operation: 'task_lifecycle.task.escalated',
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

  it('skipsFailedLifecycleLogsForRecoverableGuidedErrors', async () => {
    const error = new ValidationError(
      "Role 'Release Manager' is not defined in planned workflow playbook 'workflow-1'.",
      {
        recovery_hint: 'orchestrator_guided_recovery',
        reason_code: 'role_not_defined_in_playbook',
        recoverable: true,
      },
    );
    const service = {
      createTask: vi.fn().mockRejectedValue(error),
    };
    const logInsert = vi.fn().mockResolvedValue(undefined);
    const logService = { insert: logInsert };

    const wrapped = createLoggedService(service, 'TaskService', logService as never);

    await expect(
      wrapped.createTask({
        request_id: 'req-task-create-guided-recovery',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        stage_name: 'close',
        role: 'Release Manager',
      }),
    ).rejects.toThrow("Role 'Release Manager' is not defined in planned workflow playbook 'workflow-1'.");

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(logInsert).not.toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        status: 'failed',
        operation: 'task_lifecycle.task.created',
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

  it('logsExplicitlyConfiguredMethodsWithoutMutationPrefixes', async () => {
    const service = {
      recordBrief: vi.fn().mockResolvedValue({
        id: 'brief-1',
        workflow_id: 'workflow-1',
        brief_kind: 'milestone',
      }),
    };
    const logInsert = vi.fn().mockResolvedValue(undefined);
    const logService = { insert: logInsert };

    const wrapped = createLoggedService(service, 'WorkflowOperatorBriefService', logService as never);
    await wrapped.recordBrief({ tenantId: 'tenant-1' }, 'workflow-1', { requestId: 'brief-1' });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(logInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'task_lifecycle',
        operation: 'task_lifecycle.workflow_operator_brief.recordBrief',
        resourceType: 'workflow_operator_brief',
        resourceId: 'brief-1',
        resourceName: 'milestone',
      }),
    );
  });

  it('labels orchestrator execution rows under orchestrator instead of specialist execution', async () => {
    vi.resetModules();
    vi.doMock('../../../../src/observability/request-context.js', () => ({
      getRequestContext: () => ({
        requestId: 'req-1',
        sourceIp: '127.0.0.1',
        auth: {
          tenantId: 'tenant-1',
          scope: 'agent',
          id: 'agent-key-1',
          ownerId: 'agent-1',
        },
      }),
    }));

    try {
      const { createLoggedService: createLoggedServiceWithContext } = await import(
        '../../../../src/logging/execution/create-logged-service.js'
      );

      const service = {
        createTask: vi.fn().mockResolvedValue({
          id: 'task-1',
          title: 'Orchestrate product brief',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          role: 'orchestrator',
          is_orchestrator_task: true,
        }),
      };
      const logInsert = vi.fn().mockResolvedValue(undefined);
      const logService = { insert: logInsert };

      const wrapped = createLoggedServiceWithContext(service, 'TaskService', logService as never);
      await wrapped.createTask({
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        role: 'orchestrator',
        is_orchestrator_task: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(logInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          actorType: 'agent',
          actorName: 'Orchestrator execution',
          role: 'orchestrator',
          isOrchestratorTask: true,
        }),
      );
    } finally {
      vi.doUnmock('../../../../src/observability/request-context.js');
      vi.resetModules();
    }
  });
});
