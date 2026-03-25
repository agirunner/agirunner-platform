import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../src/errors/error-handler.js';
import { ValidationError } from '../../src/errors/domain-errors.js';
import { ArtifactService } from '../../src/services/artifact-service.js';
import { GuidedClosureRecoveryHelpersService } from '../../src/services/guided-closure/recovery-helpers.js';
import { PlaybookWorkflowControlService } from '../../src/services/playbook-workflow-control-service.js';
import { TaskAgentScopeService } from '../../src/services/task-agent-scope-service.js';
import {
  normalizeExplicitAssessmentSubjectTaskLinkage,
  normalizeOrchestratorChildWorkflowLinkage,
  orchestratorControlRoutes,
} from '../../src/api/routes/orchestrator-control.routes.js';

vi.mock('../../src/auth/fastify-auth-hook.js', () => ({
  authenticateApiKey: async (request: { auth?: unknown }) => {
    request.auth = {
      id: 'key-1',
      tenantId: 'tenant-1',
      scope: 'agent',
      ownerType: 'agent',
      ownerId: 'agent-1',
      keyPrefix: 'agent-key',
    };
  },
  withScope: () => async () => {},
}));

describe('normalizeOrchestratorChildWorkflowLinkage', () => {
  it('backfills normalized parent-child metadata on both workflows without duplicating child ids', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ metadata: { child_workflow_ids: ['wf-child-1'] } }],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ metadata: { existing: true } }],
        })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] }),
    };

    await normalizeOrchestratorChildWorkflowLinkage(
      pool as never,
      'tenant-1',
      {
        parentWorkflowId: 'wf-parent',
        parentOrchestratorTaskId: 'task-orch-1',
        parentOrchestratorActivationId: 'activation-1',
        parentWorkItemId: 'wi-1',
        parentStageName: 'implementation',
        parentContext: 'Use the shared repo state.',
      },
      'wf-child-1',
    );

    expect(pool.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('UPDATE workflows'),
      [
        'tenant-1',
        'wf-parent',
        {
          child_workflow_ids: ['wf-child-1'],
          latest_child_workflow_id: 'wf-child-1',
          latest_child_workflow_created_by_orchestrator_task_id: 'task-orch-1',
        },
      ],
    );
    expect(pool.query).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('UPDATE workflows'),
      [
        'tenant-1',
        'wf-child-1',
        {
          existing: true,
          parent_workflow_id: 'wf-parent',
          parent_orchestrator_task_id: 'task-orch-1',
          parent_orchestrator_activation_id: 'activation-1',
          parent_work_item_id: 'wi-1',
          parent_stage_name: 'implementation',
          parent_context: 'Use the shared repo state.',
          parent_link_kind: 'orchestrator_child',
        },
      ],
    );
  });
});

describe('orchestratorControlRoutes', () => {
  let app: ReturnType<typeof fastify> | undefined;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('records an advisory result instead of failing when gate approval is requested for an unconfigured stage', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const requestStageGateApprovalSpy = vi
      .spyOn(PlaybookWorkflowControlService.prototype, 'requestStageGateApproval')
      .mockRejectedValue(new ValidationError("Stage 'operator-approval' does not require a human gate"));
    const loadTaskScopeSpy = vi
      .spyOn(TaskAgentScopeService.prototype, 'loadAgentOwnedOrchestratorTask')
      .mockResolvedValue({
      id: 'task-orchestrator',
      workflow_id: 'workflow-1',
      workspace_id: 'workspace-1',
      work_item_id: 'work-item-1',
      stage_name: 'draft-package',
      activation_id: 'activation-1',
      assigned_agent_id: 'agent-1',
      assigned_worker_id: null,
      is_orchestrator_task: true,
      state: 'in_progress',
    });
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'request_gate_approval', 'request-gate-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return { rowCount: 1, rows: [{ response: params?.[4] }] };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn(async () => client),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', eventService);
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn(), getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', {});
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/stages/operator-approval/request-gate',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'request-gate-1',
        summary: 'Need human approval before release',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({
      advisory: true,
      advisory_event_type: 'workflow.advisory_recorded',
      advisory_kind: 'approval_not_configured',
      advisory_recorded: true,
      blocking: false,
      callout_recommendations: [
        {
          code: 'approval_not_configured',
          summary: "Stage 'operator-approval' does not require a human gate",
        },
      ],
      closure_still_possible: true,
      configured: false,
      control_type: 'approval',
      message: "Stage 'operator-approval' does not require a human gate",
      mutation_outcome: 'recoverable_not_applied',
      reason_code: 'approval_not_configured',
      recovery_class: 'approval_not_configured',
      request_summary: 'Need human approval before release',
      state_snapshot: {
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        task_id: 'task-orchestrator',
        current_stage: 'draft-package',
        active_blocking_controls: [],
        active_advisory_controls: [],
      },
      stage_name: 'operator-approval',
      status: 'ignored_not_configured',
      suggested_next_actions: [
        {
          action_code: 'continue_work',
          target_type: 'work_item',
          target_id: 'work-item-1',
          why: 'The stage has no configured blocking approval gate.',
          requires_orchestrator_judgment: false,
        },
        {
          action_code: 'record_callout',
          target_type: 'workflow',
          target_id: 'workflow-1',
          why: 'Persist the advisory concern if the workflow closes without a separate approval.',
          requires_orchestrator_judgment: true,
        },
      ],
      suggested_target_ids: {
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        task_id: 'task-orchestrator',
      },
      task_id: 'task-orchestrator',
      work_item_id: 'work-item-1',
      workflow_id: 'workflow-1',
    });
    expect(requestStageGateApprovalSpy).toHaveBeenCalledTimes(1);
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workflow.advisory_recorded',
        entityType: 'workflow',
        entityId: 'workflow-1',
        data: expect.objectContaining({
          advisory_kind: 'approval_not_configured',
      configured: false,
      blocking: false,
      stage_name: 'operator-approval',
      task_id: 'task-orchestrator',
      work_item_id: 'work-item-1',
        }),
      }),
      client,
    );
    requestStageGateApprovalSpy.mockRestore();
    loadTaskScopeSpy.mockRestore();
  });

  it('rejects invalid managed task ids before loading specialist task state', async () => {
    const loadTaskScopeSpy = vi
      .spyOn(TaskAgentScopeService.prototype, 'loadAgentOwnedOrchestratorTask')
      .mockResolvedValue({
        id: 'task-orchestrator',
        workflow_id: 'workflow-1',
        workspace_id: 'workspace-1',
        work_item_id: 'work-item-1',
        stage_name: 'draft-package',
        activation_id: 'activation-1',
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        is_orchestrator_task: true,
        state: 'in_progress',
      });
    const getTask = vi.fn();

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', { connect: vi.fn(), query: vi.fn() });
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn(), getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', {
      getTask,
      approveTask: vi.fn(),
    });
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/tasks/task_95bde3c4/approve',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'approve-1',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('managed task id must be a valid uuid');
    expect(loadTaskScopeSpy).toHaveBeenCalledOnce();
    expect(getTask).not.toHaveBeenCalled();
    loadTaskScopeSpy.mockRestore();
  });

  it('accepts structured closure callouts when completing a work item', async () => {
    const completeWorkItemSpy = vi
      .spyOn(PlaybookWorkflowControlService.prototype, 'completeWorkItem')
      .mockResolvedValue({
        id: 'work-item-1',
        stage_name: 'review',
        column_id: 'done',
        completion_callouts: {
          completion_notes: 'Closed with one waived preferred review.',
          waived_steps: [{ code: 'secondary_review', reason: 'Primary review was decisive.' }],
          unresolved_advisory_items: [{ kind: 'approval', id: 'gate-1', summary: 'Approval stayed advisory.' }],
          residual_risks: [],
          unmet_preferred_expectations: [],
        },
      } as never);
    const loadTaskScopeSpy = vi
      .spyOn(TaskAgentScopeService.prototype, 'loadAgentOwnedOrchestratorTask')
      .mockResolvedValue({
        id: 'task-orchestrator',
        workflow_id: 'workflow-1',
        workspace_id: 'workspace-1',
        work_item_id: 'work-item-1',
        stage_name: 'review',
        activation_id: 'activation-1',
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        is_orchestrator_task: true,
        state: 'in_progress',
      });

    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'complete_work_item', 'complete-work-item-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return { rowCount: 1, rows: [{ response: params?.[4] }] };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', { connect: vi.fn(async () => client) });
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn(), getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', {});
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/work-items/work-item-1/complete',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'complete-work-item-1',
        waived_steps: [{ code: 'secondary_review', reason: 'Primary review was decisive.' }],
        unresolved_advisory_items: [{ kind: 'approval', id: 'gate-1', summary: 'Approval stayed advisory.' }],
        completion_notes: 'Closed with one waived preferred review.',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(completeWorkItemSpy).toHaveBeenCalledWith(
      expect.anything(),
      'workflow-1',
      'work-item-1',
      {
        acting_task_id: 'task-orchestrator',
        request_id: 'complete-work-item-1',
        waived_steps: [{ code: 'secondary_review', reason: 'Primary review was decisive.' }],
        unresolved_advisory_items: [{ kind: 'approval', id: 'gate-1', summary: 'Approval stayed advisory.' }],
        completion_notes: 'Closed with one waived preferred review.',
      },
      expect.anything(),
    );

    completeWorkItemSpy.mockRestore();
    loadTaskScopeSpy.mockRestore();
  });

  it('returns a structured no-op when completing a work item before specialist tasks settle', async () => {
    const completeWorkItemSpy = vi
      .spyOn(PlaybookWorkflowControlService.prototype, 'completeWorkItem')
      .mockRejectedValue(
        new ValidationError(
          "Cannot complete work item 'Draft product brief' while task 'policy-reviewer' is still in_progress.",
        ),
      );
    const loadTaskScopeSpy = vi
      .spyOn(TaskAgentScopeService.prototype, 'loadAgentOwnedOrchestratorTask')
      .mockResolvedValue({
        id: 'task-orchestrator',
        workflow_id: 'workflow-1',
        workspace_id: 'workspace-1',
        work_item_id: 'work-item-1',
        stage_name: 'review',
        activation_id: 'activation-1',
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        is_orchestrator_task: true,
        state: 'in_progress',
      });

    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'complete_work_item', 'complete-work-item-not-ready']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          expect(params?.[5]).toBe('recoverable_not_applied');
          expect(params?.[6]).toBe('work_item_tasks_not_ready');
          expect(params?.[4]).toMatchObject({
            mutation_outcome: 'recoverable_not_applied',
            recovery_class: 'work_item_tasks_not_ready',
            closure_still_possible: true,
          });
          return {
            rowCount: 1,
            rows: [{ response: params?.[4] }],
          };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', { connect: vi.fn(async () => client) });
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn(), getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', {});
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/work-items/work-item-1/complete',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'complete-work-item-not-ready',
        completion_notes: 'Close after accepted review.',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual(
      expect.objectContaining({
        mutation_outcome: 'recoverable_not_applied',
        recovery_class: 'work_item_tasks_not_ready',
        noop: true,
        ready: false,
        reason_code: 'work_item_tasks_not_ready',
        work_item_id: 'work-item-1',
      }),
    );

    completeWorkItemSpy.mockRestore();
    loadTaskScopeSpy.mockRestore();
  });

  it('accepts structured closure callouts when completing a workflow', async () => {
    const completeWorkflowSpy = vi
      .spyOn(PlaybookWorkflowControlService.prototype, 'completeWorkflow')
      .mockResolvedValue({
        workflow_id: 'workflow-1',
        state: 'completed',
        summary: 'Ship it',
        final_artifacts: ['artifacts/release-notes.md'],
        completion_callouts: {
          completion_notes: 'Shipped with one advisory escalation still open.',
          waived_steps: [{ code: 'extra_review', reason: 'Core review already covered the risk.' }],
          unresolved_advisory_items: [{ kind: 'escalation', id: 'esc-1', summary: 'Escalation was advisory.' }],
          residual_risks: [],
          unmet_preferred_expectations: [],
        },
      } as never);
    const loadTaskScopeSpy = vi
      .spyOn(TaskAgentScopeService.prototype, 'loadAgentOwnedOrchestratorTask')
      .mockResolvedValue({
        id: 'task-orchestrator',
        workflow_id: 'workflow-1',
        workspace_id: 'workspace-1',
        work_item_id: 'work-item-1',
        stage_name: 'release',
        activation_id: 'activation-1',
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        is_orchestrator_task: true,
        state: 'in_progress',
      });

    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'complete_workflow', 'complete-workflow-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return { rowCount: 1, rows: [{ response: params?.[4] }] };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', { connect: vi.fn(async () => client) });
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn(), getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', {});
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/workflow/complete',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'complete-workflow-1',
        summary: 'Ship it',
        final_artifacts: ['artifacts/release-notes.md'],
        completion_callouts: {
          residual_risks: [],
          unmet_preferred_expectations: [],
          waived_steps: [],
          unresolved_advisory_items: [],
          completion_notes: 'Workflow closed with advisory callouts.',
        },
        waived_steps: [{ code: 'extra_review', reason: 'Core review already covered the risk.' }],
        unresolved_advisory_items: [{ kind: 'escalation', id: 'esc-1', summary: 'Escalation was advisory.' }],
        completion_notes: 'Shipped with one advisory escalation still open.',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(completeWorkflowSpy).toHaveBeenCalledWith(
      expect.anything(),
      'workflow-1',
      {
        request_id: 'complete-workflow-1',
        summary: 'Ship it',
        final_artifacts: ['artifacts/release-notes.md'],
        completion_callouts: {
          residual_risks: [],
          unmet_preferred_expectations: [],
          waived_steps: [],
          unresolved_advisory_items: [],
          completion_notes: 'Workflow closed with advisory callouts.',
        },
        waived_steps: [{ code: 'extra_review', reason: 'Core review already covered the risk.' }],
        unresolved_advisory_items: [{ kind: 'escalation', id: 'esc-1', summary: 'Escalation was advisory.' }],
        completion_notes: 'Shipped with one advisory escalation still open.',
      },
      expect.anything(),
    );

    completeWorkflowSpy.mockRestore();
    loadTaskScopeSpy.mockRestore();
  });

  it('reruns specialist work with a corrected brief through the recovery helper route', async () => {
    const rerunSpy = vi
      .spyOn(GuidedClosureRecoveryHelpersService.prototype, 'rerunTaskWithCorrectedBrief')
      .mockResolvedValue({ id: '22222222-2222-4222-8222-222222222222', state: 'ready' } as never);
    const loadTaskScopeSpy = vi
      .spyOn(TaskAgentScopeService.prototype, 'loadAgentOwnedOrchestratorTask')
      .mockResolvedValue({
        id: 'task-orchestrator',
        workflow_id: 'workflow-1',
        workspace_id: 'workspace-1',
        work_item_id: 'work-item-1',
        stage_name: 'review',
        activation_id: 'activation-1',
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        is_orchestrator_task: true,
        state: 'in_progress',
      });

    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'rerun_task_with_corrected_brief', 'rerun-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return { rowCount: 1, rows: [{ response: params?.[4] }] };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', { connect: vi.fn(async () => client) });
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn(), getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', {
      getTask: vi.fn(async () => ({ id: '22222222-2222-4222-8222-222222222222', workflow_id: 'workflow-1', is_orchestrator_task: false })),
    });
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/tasks/22222222-2222-4222-8222-222222222222/rerun-with-corrected-brief',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'rerun-1',
        corrected_input: { reviewer_contract: 'Use concrete findings and cite the exact artifact.' },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(rerunSpy).toHaveBeenCalledWith(
      expect.anything(),
      '22222222-2222-4222-8222-222222222222',
      {
        request_id: 'rerun-1',
        corrected_input: { reviewer_contract: 'Use concrete findings and cite the exact artifact.' },
      },
      expect.anything(),
    );

    rerunSpy.mockRestore();
    loadTaskScopeSpy.mockRestore();
  });

  it('reattaches or replaces stale ownership through the recovery helper route', async () => {
    const reassignSpy = vi
      .spyOn(GuidedClosureRecoveryHelpersService.prototype, 'reattachOrReplaceStaleOwner')
      .mockResolvedValue({ id: '22222222-2222-4222-8222-222222222222', state: 'ready' } as never);
    const loadTaskScopeSpy = vi
      .spyOn(TaskAgentScopeService.prototype, 'loadAgentOwnedOrchestratorTask')
      .mockResolvedValue({
        id: 'task-orchestrator',
        workflow_id: 'workflow-1',
        workspace_id: 'workspace-1',
        work_item_id: 'work-item-1',
        stage_name: 'review',
        activation_id: 'activation-1',
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        is_orchestrator_task: true,
        state: 'in_progress',
      });

    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'reattach_or_replace_stale_owner', 'reassign-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return { rowCount: 1, rows: [{ response: params?.[4] }] };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', { connect: vi.fn(async () => client) });
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn(), getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', {
      getTask: vi.fn(async () => ({ id: '22222222-2222-4222-8222-222222222222', workflow_id: 'workflow-1', is_orchestrator_task: false })),
    });
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/tasks/22222222-2222-4222-8222-222222222222/reattach-or-replace-stale-owner',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'reassign-1',
        reason: 'The prior owner lost its lease and the task still needs progress.',
        preferred_worker_id: '00000000-0000-4000-8000-000000000001',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(reassignSpy).toHaveBeenCalledWith(
      expect.anything(),
      '22222222-2222-4222-8222-222222222222',
      {
        request_id: 'reassign-1',
        reason: 'The prior owner lost its lease and the task still needs progress.',
        preferred_worker_id: '00000000-0000-4000-8000-000000000001',
      },
      expect.anything(),
    );

    reassignSpy.mockRestore();
    loadTaskScopeSpy.mockRestore();
  });

  it('reopens a work item for missing handoff recovery through the helper route', async () => {
    const reopenSpy = vi
      .spyOn(GuidedClosureRecoveryHelpersService.prototype, 'reopenWorkItemForMissingHandoff')
      .mockResolvedValue({
        id: 'work-item-1',
        workflow_id: 'workflow-1',
        column_id: 'planned',
        completed_at: null,
      } as never);
    const loadTaskScopeSpy = vi
      .spyOn(TaskAgentScopeService.prototype, 'loadAgentOwnedOrchestratorTask')
      .mockResolvedValue({
        id: 'task-orchestrator',
        workflow_id: 'workflow-1',
        workspace_id: 'workspace-1',
        work_item_id: 'work-item-1',
        stage_name: 'review',
        activation_id: 'activation-1',
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        is_orchestrator_task: true,
        state: 'in_progress',
      });

    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'reopen_work_item_for_missing_handoff', 'reopen-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return { rowCount: 1, rows: [{ response: params?.[4] }] };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', { connect: vi.fn(async () => client) });
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn(), getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', {});
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/work-items/work-item-1/reopen-for-missing-handoff',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'reopen-1',
        reason: 'The predecessor exited without a full handoff.',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(reopenSpy).toHaveBeenCalledWith(
      expect.anything(),
      'workflow-1',
      'work-item-1',
      { reason: 'The predecessor exited without a full handoff.' },
      expect.anything(),
    );

    reopenSpy.mockRestore();
    loadTaskScopeSpy.mockRestore();
  });

  it('waives a preferred step through the recovery helper route', async () => {
    const waiveSpy = vi
      .spyOn(GuidedClosureRecoveryHelpersService.prototype, 'waivePreferredStep')
      .mockResolvedValue({
        id: 'work-item-1',
        workflow_id: 'workflow-1',
        completion_callouts: {
          waived_steps: [{ code: 'secondary_review', reason: 'Primary review was decisive.' }],
        },
      } as never);
    const loadTaskScopeSpy = vi
      .spyOn(TaskAgentScopeService.prototype, 'loadAgentOwnedOrchestratorTask')
      .mockResolvedValue({
        id: 'task-orchestrator',
        workflow_id: 'workflow-1',
        workspace_id: 'workspace-1',
        work_item_id: 'work-item-1',
        stage_name: 'review',
        activation_id: 'activation-1',
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        is_orchestrator_task: true,
        state: 'in_progress',
      });

    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'waive_preferred_step', 'waive-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return { rowCount: 1, rows: [{ response: params?.[4] }] };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', { connect: vi.fn(async () => client) });
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn(), getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', {});
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/work-items/work-item-1/waive-preferred-step',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'waive-1',
        code: 'secondary_review',
        reason: 'Primary review was decisive.',
        role: 'secondary-reviewer',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(waiveSpy).toHaveBeenCalledWith(
      expect.anything(),
      'workflow-1',
      'work-item-1',
      {
        code: 'secondary_review',
        reason: 'Primary review was decisive.',
        role: 'secondary-reviewer',
        summary: undefined,
      },
      expect.anything(),
    );

    waiveSpy.mockRestore();
    loadTaskScopeSpy.mockRestore();
  });

  it('closes a work item with callouts through the helper alias route', async () => {
    const closeSpy = vi
      .spyOn(GuidedClosureRecoveryHelpersService.prototype, 'closeWorkItemWithCallouts')
      .mockResolvedValue({
        id: 'work-item-1',
        workflow_id: 'workflow-1',
        completion_callouts: {
          completion_notes: 'Closed with advisory callouts.',
        },
      } as never);
    const loadTaskScopeSpy = vi
      .spyOn(TaskAgentScopeService.prototype, 'loadAgentOwnedOrchestratorTask')
      .mockResolvedValue({
        id: 'task-orchestrator',
        workflow_id: 'workflow-1',
        workspace_id: 'workspace-1',
        work_item_id: 'work-item-1',
        stage_name: 'review',
        activation_id: 'activation-1',
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        is_orchestrator_task: true,
        state: 'in_progress',
      });

    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'close_work_item_with_callouts', 'close-helper-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return { rowCount: 1, rows: [{ response: params?.[4] }] };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', { connect: vi.fn(async () => client) });
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn(), getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', {});
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/work-items/work-item-1/close-with-callouts',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'close-helper-1',
        completion_notes: 'Closed with advisory callouts.',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(closeSpy).toHaveBeenCalledWith(
      expect.anything(),
      'workflow-1',
      'work-item-1',
      {
        acting_task_id: 'task-orchestrator',
        request_id: 'close-helper-1',
        completion_notes: 'Closed with advisory callouts.',
      },
      expect.anything(),
    );

    closeSpy.mockRestore();
    loadTaskScopeSpy.mockRestore();
  });

  it('closes a workflow with callouts through the helper alias route', async () => {
    const closeSpy = vi
      .spyOn(GuidedClosureRecoveryHelpersService.prototype, 'closeWorkflowWithCallouts')
      .mockResolvedValue({
        workflow_id: 'workflow-1',
        state: 'completed',
      } as never);
    const loadTaskScopeSpy = vi
      .spyOn(TaskAgentScopeService.prototype, 'loadAgentOwnedOrchestratorTask')
      .mockResolvedValue({
        id: 'task-orchestrator',
        workflow_id: 'workflow-1',
        workspace_id: 'workspace-1',
        work_item_id: 'work-item-1',
        stage_name: 'release',
        activation_id: 'activation-1',
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        is_orchestrator_task: true,
        state: 'in_progress',
      });

    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'close_workflow_with_callouts', 'close-workflow-helper-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return { rowCount: 1, rows: [{ response: params?.[4] }] };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', { connect: vi.fn(async () => client) });
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn(), getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', {});
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/workflow/close-with-callouts',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'close-workflow-helper-1',
        summary: 'Ship the release with recorded advisory callouts.',
        completion_notes: 'Closed with advisory callouts.',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(closeSpy).toHaveBeenCalledWith(
      expect.anything(),
      'workflow-1',
      {
        request_id: 'close-workflow-helper-1',
        summary: 'Ship the release with recorded advisory callouts.',
        completion_notes: 'Closed with advisory callouts.',
      },
      expect.anything(),
    );

    closeSpy.mockRestore();
    loadTaskScopeSpy.mockRestore();
  });

  it('rejects create_task when legacy governance flags are provided', async () => {
    const createTask = vi.fn();

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', {
      connect: vi.fn(),
      query: vi.fn(),
    });
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn(), getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', {
      createTask,
    });
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    const loadTaskScopeSpy = vi
      .spyOn(TaskAgentScopeService.prototype, 'loadAgentOwnedOrchestratorTask')
      .mockResolvedValue({
        id: 'task-orchestrator',
        workflow_id: 'workflow-1',
        workspace_id: 'workspace-1',
        work_item_id: 'work-item-1',
        stage_name: 'draft-package',
        activation_id: 'activation-1',
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        is_orchestrator_task: true,
        state: 'in_progress',
      });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/tasks',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'request-task-1',
        title: 'Legacy governed task',
        description: 'Do the work',
        work_item_id: 'work-item-1',
        stage_name: 'draft-package',
        role: 'writer',
        requires_approval: true,
        requires_assessment: true,
      },
    });

    expect(response.statusCode).toBe(422);
    expect(createTask).not.toHaveBeenCalled();
    loadTaskScopeSpy.mockRestore();
  });

  it('returns managed specialist task details through the orchestrator-scoped read route', async () => {
    const getTask = vi.fn(async () => ({
      id: '22222222-2222-4222-8222-222222222222',
      workflow_id: 'workflow-1',
      work_item_id: 'work-item-1',
      title: 'Assess host content',
      role: 'host-acceptance-assessor',
      state: 'completed',
      stage_name: 'maintenance-window',
      output: { summary: 'Looks good.' },
      metrics: { tokens_total: 42 },
      latest_handoff: { id: 'handoff-1', summary: 'Approved.' },
      metadata: { current_subject_revision: 1 },
      rework_count: 0,
      is_orchestrator_task: false,
    }));
    const listTaskArtifactsSpy = vi
      .spyOn(ArtifactService.prototype, 'listTaskArtifacts')
      .mockResolvedValue([
        {
          id: 'artifact-1',
          task_id: '22222222-2222-4222-8222-222222222222',
          logical_path: 'artifact:wf-1/report.md',
          content_type: 'text/markdown',
          size_bytes: 42,
          created_at: '2026-03-24T18:00:00Z',
        } as never,
      ]);

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', {
      connect: vi.fn(),
      query: vi.fn(),
    });
    app.decorate('config', {
      TASK_DEFAULT_TIMEOUT_MINUTES: 30,
      ARTIFACT_STORAGE_BACKEND: 'local',
      ARTIFACT_LOCAL_ROOT: '/tmp/agirunner-platform-artifacts-test',
      ARTIFACT_ACCESS_URL_TTL_SECONDS: 300,
      ARTIFACT_PREVIEW_MAX_BYTES: 1048576,
    });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn(), getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', { getTask });
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    const loadTaskScopeSpy = vi
      .spyOn(TaskAgentScopeService.prototype, 'loadAgentOwnedOrchestratorTask')
      .mockResolvedValue({
        id: 'task-orchestrator',
        workflow_id: 'workflow-1',
        workspace_id: 'workspace-1',
        work_item_id: 'work-item-1',
        stage_name: 'maintenance-window',
        activation_id: 'activation-1',
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        is_orchestrator_task: true,
        state: 'in_progress',
      });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/tasks/22222222-2222-4222-8222-222222222222',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(getTask).toHaveBeenCalledWith('tenant-1', '22222222-2222-4222-8222-222222222222');
    expect(listTaskArtifactsSpy).toHaveBeenCalledWith('tenant-1', '22222222-2222-4222-8222-222222222222');
    expect(response.json().data).toEqual(
      expect.objectContaining({
        id: '22222222-2222-4222-8222-222222222222',
        workflow_id: 'workflow-1',
        state: 'completed',
        title: 'Assess host content',
        artifacts: [
          expect.objectContaining({
            id: 'artifact-1',
            logical_path: 'artifact:wf-1/report.md',
          }),
        ],
      }),
    );

    listTaskArtifactsSpy.mockRestore();
    loadTaskScopeSpy.mockRestore();
  });

  it('replays stored create_work_item results after recovery without rerunning the mutation', async () => {
    const workflowService = {
      createWorkflowWorkItem: vi.fn(),
    };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'create_work_item',
            'smk120-item-1',
          ]);
          return {
            rowCount: 1,
            rows: [{
              response: {
                id: 'work-item-1',
                workflow_id: 'workflow-1',
                parent_work_item_id: null,
                stage_name: 'triage',
                title: 'Recovered work item',
                goal: 'Original replay-safe goal',
                acceptance_criteria: null,
                column_id: 'backlog',
                owner_role: null,
                priority: 'normal',
                notes: null,
                metadata: {},
                completed_at: null,
                updated_at: '2026-03-12T00:00:00.000Z',
              },
            }],
          };
        }
        return { rowCount: 0, rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-replay']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-replay',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: null,
              stage_name: 'triage',
              activation_id: 'activation-1',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workflow_activations wa')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-1']);
          return {
            rowCount: 1,
            rows: [{
              lifecycle: null,
              event_type: null,
              payload: {},
            }],
          };
        }
        return { rowCount: 0, rows: [] };
      }),
      connect: vi.fn(async () => client),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', workflowService);
    app.decorate('taskService', { createTask: vi.fn() });
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-replay/work-items',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'smk120-item-1',
        title: 'Recovered work item',
        goal: 'Changed replay text after recovery',
        acceptance_criteria: 'Recovered acceptance criteria',
        stage_name: 'triage',
        column_id: 'backlog',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toEqual(
      expect.objectContaining({
        id: 'work-item-1',
        workflow_id: 'workflow-1',
        goal: 'Original replay-safe goal',
      }),
    );
    expect(workflowService.createWorkflowWorkItem).not.toHaveBeenCalled();
  });

  it('rejects create_work_item without request_id', async () => {
    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', { query: vi.fn(), connect: vi.fn() });
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', { createTask: vi.fn() });
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-replay/work-items',
      headers: { authorization: 'Bearer test' },
      payload: {
        title: 'Recovered work item',
        goal: 'Changed replay text after recovery',
        acceptance_criteria: 'Recovered acceptance criteria',
        stage_name: 'triage',
        column_id: 'backlog',
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('SCHEMA_VALIDATION_FAILED');
  });

  it('returns a structured no-op when successor work is not ready yet', async () => {
    const workflowService = {
      createWorkflowWorkItem: vi.fn(async () => {
        throw new ValidationError(
          "Cannot create successor work item in stage 'technical-review' while predecessor 'Draft PRD for workflow budget alerts' (requirements) still has non-terminal tasks. Wait for the current stage work item to finish before routing to the next stage.",
        );
      }),
    };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'create_work_item',
            'create-wi-not-ready',
          ]);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          expect(params?.[5]).toBe('recoverable_not_applied');
          expect(params?.[6]).toBe('predecessor_not_ready');
          expect(params?.[4]).toMatchObject({
            mutation_outcome: 'recoverable_not_applied',
            recovery_class: 'predecessor_not_ready',
            closure_still_possible: true,
          });
          return {
            rowCount: 1,
            rows: [{
              response: params?.[4],
            }],
          };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-not-ready']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-not-ready',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: null,
              stage_name: 'requirements',
              activation_id: 'activation-1',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(async () => client),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', workflowService);
    app.decorate('taskService', { createTask: vi.fn() });
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-not-ready/work-items',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'create-wi-not-ready',
        parent_work_item_id: '11111111-1111-4111-8111-111111111111',
        title: 'Technical review for workflow budget alerts PRD',
        goal: 'Produce a technical review artifact for the PRD',
        acceptance_criteria: 'Review artifact exists',
        stage_name: 'technical-review',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual(
      expect.objectContaining({
        mutation_outcome: 'recoverable_not_applied',
        recovery_class: 'predecessor_not_ready',
        noop: true,
        ready: false,
        reason_code: 'predecessor_not_ready',
        stage_name: 'technical-review',
        work_item_id: null,
      }),
    );
  });

  it('rejects orchestrator continuity writes with non-allowlisted fields', async () => {
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-replay']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-replay',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: 'work-item-1',
              stage_name: 'release',
              activation_id: 'activation-1',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', { createTask: vi.fn() });
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-replay/continuity',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'cont-1',
        status_summary: 'waiting',
        unexpected_field: 'reject me',
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('SCHEMA_VALIDATION_FAILED');
  });

  it('accepts orchestrator continuity writes with long next_expected_action text', async () => {
    const longAction =
      'Draft the PRD, upload it as requirements/prd.md, write workspace memory key prd_summary, and leave the required handoff to the architect.';
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'continuity_write', 'cont-long-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-replay']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-replay',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: 'work-item-1',
              stage_name: 'requirements',
              activation_id: 'activation-1',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('SELECT next_expected_actor') && sql.includes('FROM workflow_work_items')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'work-item-1']);
          return {
            rowCount: 1,
            rows: [{
              next_expected_actor: null,
              next_expected_action: null,
              parent_work_item_id: null,
              metadata: {},
            }],
          };
        }
        if (sql.includes('SELECT queued_at') && sql.includes('FROM workflow_activations')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-1']);
          return {
            rowCount: 1,
            rows: [{ queued_at: new Date('2026-03-21T17:00:00.000Z') }],
          };
        }
        if (sql.includes('SELECT EXISTS (') && sql.includes('has_newer_specialist_handoff')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            expect.any(Date),
            ['work-item-1'],
          ]);
          return {
            rowCount: 1,
            rows: [{ has_newer_specialist_handoff: false }],
          };
        }
        if (sql.includes('UPDATE workflow_work_items')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'work-item-1',
            null,
            null,
            {
              orchestrator_finish_state: {
                status_summary: 'Waiting on PRD drafting.',
                next_expected_event: 'task.handoff_submitted',
                active_subordinate_tasks: ['task-specialist-1'],
              },
            },
          ]);
          return {
            rowCount: 1,
            rows: [{
              next_expected_actor: null,
              next_expected_action: null,
              metadata: {
                orchestrator_finish_state: {
                  status_summary: 'Waiting on PRD drafting.',
                  next_expected_event: 'task.handoff_submitted',
                  blocked_on: [],
                  active_subordinate_tasks: ['task-specialist-1'],
                },
              },
            }],
          };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return {
            rowCount: 1,
            rows: [{
              response: {
                nextExpectedActor: null,
                nextExpectedAction: null,
                continuity: {
                  status_summary: 'Waiting on PRD drafting.',
                  next_expected_event: 'task.handoff_submitted',
                  active_subordinate_tasks: ['task-specialist-1'],
                },
              },
            }],
          };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(async () => ({
        query: pool.query,
        release: vi.fn(),
      })),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', { createTask: vi.fn() });
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-replay/continuity',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'cont-long-1',
        next_expected_actor: 'live-test-product-manager',
        next_expected_action: longAction,
        status_summary: 'Waiting on PRD drafting.',
        next_expected_event: 'task.handoff_submitted',
        active_subordinate_tasks: ['task-specialist-1'],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.nextExpectedAction).toBeNull();
    expect(response.json().data.continuity.status_summary).toBe('Waiting on PRD drafting.');
  });

  it('resolves continuity work item from active subordinate tasks when the orchestrator task is workflow-scoped', async () => {
    const activeTaskId = '11111111-1111-4111-8111-111111111111';
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'continuity_write', 'cont-infer-1']);
          return { rowCount: 0, rows: [] };
        }
        if (
          sql.includes('FROM tasks')
          && sql.includes('WHERE tenant_id = $1')
          && sql.includes('AND id = $2')
          && !sql.includes('ANY($3')
        ) {
          expect(params).toEqual(['tenant-1', 'task-replay']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-replay',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: null,
              stage_name: 'requirements',
              activation_id: 'activation-1',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('ANY($3::uuid[])')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', [activeTaskId]]);
          return {
            rowCount: 1,
            rows: [{ work_item_id: 'work-item-1' }],
          };
        }
        if (sql.includes('SELECT next_expected_actor') && sql.includes('FROM workflow_work_items')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'work-item-1']);
          return {
            rowCount: 1,
            rows: [{
              next_expected_actor: null,
              next_expected_action: null,
              parent_work_item_id: null,
              metadata: {},
            }],
          };
        }
        if (sql.includes('SELECT queued_at') && sql.includes('FROM workflow_activations')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-1']);
          return {
            rowCount: 1,
            rows: [{ queued_at: new Date('2026-03-21T17:00:00.000Z') }],
          };
        }
        if (sql.includes('SELECT EXISTS (') && sql.includes('has_newer_specialist_handoff')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            expect.any(Date),
            ['work-item-1'],
          ]);
          return {
            rowCount: 1,
            rows: [{ has_newer_specialist_handoff: false }],
          };
        }
        if (sql.includes('UPDATE workflow_work_items')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'work-item-1',
            null,
            null,
            {
              orchestrator_finish_state: {
                status_summary: 'PRD drafting is already in progress.',
                next_expected_event: 'task.handoff_submitted',
                active_subordinate_tasks: [activeTaskId],
              },
            },
          ]);
          return {
            rowCount: 1,
            rows: [{
              next_expected_actor: null,
              next_expected_action: null,
              metadata: {
                orchestrator_finish_state: {
                  status_summary: 'PRD drafting is already in progress.',
                  next_expected_event: 'task.handoff_submitted',
                  active_subordinate_tasks: [activeTaskId],
                },
              },
            }],
          };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return {
            rowCount: 1,
            rows: [{
              response: {
                nextExpectedActor: null,
                nextExpectedAction: null,
                continuity: {
                  status_summary: 'PRD drafting is already in progress.',
                  next_expected_event: 'task.handoff_submitted',
                  active_subordinate_tasks: ['task-specialist-1'],
                },
              },
            }],
          };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(async () => ({
        query: pool.query,
        release: vi.fn(),
      })),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', { createTask: vi.fn() });
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-replay/continuity',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'cont-infer-1',
        next_expected_actor: 'live-test-product-manager',
        next_expected_action: 'Complete the active PRD task and upload requirements/prd.md.',
        status_summary: 'PRD drafting is already in progress.',
        next_expected_event: 'task.handoff_submitted',
        active_subordinate_tasks: [activeTaskId],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.nextExpectedAction).toBeNull();
    expect(response.json().data.continuity.status_summary).toBe(
      'PRD drafting is already in progress.',
    );
  });

  it('returns a structured recovery hint when continuity scope is ambiguous', async () => {
    const activeTaskIds = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ];
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2') && !sql.includes('ANY($3')) {
          expect(params).toEqual(['tenant-1', 'task-replay']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-replay',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: null,
              stage_name: 'requirements',
              activation_id: 'activation-1',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('ANY($3::uuid[])')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', activeTaskIds]);
          return {
            rowCount: 2,
            rows: [{ work_item_id: 'work-item-1' }, { work_item_id: 'work-item-2' }],
          };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(async () => ({
        query: pool.query,
        release: vi.fn(),
      })),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', { createTask: vi.fn() });
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-replay/continuity',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'cont-ambiguous-1',
        next_expected_actor: 'live-test-product-manager',
        next_expected_action: 'Complete the active PRD task.',
        active_subordinate_tasks: activeTaskIds,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.recovery_hint).toBe('skip_optional_continuity_write');
    expect(response.json().error.details.reason_code).toBe('ambiguous_work_item_scope');
  });

  it('accepts create_work_item without column_id so the playbook intake lane can apply', async () => {
    const workflowService = {
      createWorkflowWorkItem: vi.fn(async () => ({
        id: 'work-item-1',
        workflow_id: 'workflow-1',
        stage_name: 'requirements',
        column_id: 'planned',
      })),
    };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'create_work_item', 'create-wi-default-column']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return {
            rowCount: 1,
            rows: [{ response: { id: 'work-item-1', workflow_id: 'workflow-1', stage_name: 'requirements', column_id: 'planned' } }],
          };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-create-default-column']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-create-default-column',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: null,
              stage_name: 'requirements',
              activation_id: 'activation-1',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workflow_activations wa')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-1']);
          return {
            rowCount: 1,
            rows: [{
              lifecycle: null,
              event_type: null,
              payload: {},
            }],
          };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(async () => client),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', workflowService);
    app.decorate('taskService', { createTask: vi.fn() });
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-create-default-column/work-items',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'create-wi-default-column',
        title: 'Requirements',
        goal: 'Define requirements',
        acceptance_criteria: 'Requirements exist',
        stage_name: 'requirements',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(workflowService.createWorkflowWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workflow-1',
      expect.objectContaining({
        request_id: 'create-wi-default-column',
        stage_name: 'requirements',
      }),
      client,
    );
    const createWorkItemPayload = (workflowService.createWorkflowWorkItem as any).mock.calls[0]?.[2];
    expect(createWorkItemPayload).not.toHaveProperty('column_id');
  });

  it('defaults parent_work_item_id from the triggering activation for planned successor work', async () => {
    const parentWorkItemId = '11111111-1111-4111-8111-111111111111';
    const workflowService = {
      createWorkflowWorkItem: vi.fn(async () => ({
        id: 'work-item-2',
        workflow_id: 'workflow-1',
        stage_name: 'implementation',
        parent_work_item_id: parentWorkItemId,
      })),
    };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'create_work_item', 'create-wi-successor']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return {
            rowCount: 1,
            rows: [{
              response: {
                id: 'work-item-2',
                workflow_id: 'workflow-1',
                stage_name: 'implementation',
                parent_work_item_id: parentWorkItemId,
              },
            }],
          };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-create-successor']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-create-successor',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: null,
              stage_name: 'design',
              activation_id: 'activation-parent',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workflow_activations wa')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-parent']);
          return {
            rowCount: 1,
            rows: [{
              lifecycle: 'planned',
              event_type: 'task.completed',
              payload: {
                work_item_id: parentWorkItemId,
              },
            }],
          };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(async () => client),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', workflowService);
    app.decorate('taskService', { createTask: vi.fn() });
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-create-successor/work-items',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'create-wi-successor',
        title: 'Implementation',
        goal: 'Build the feature',
        acceptance_criteria: 'Feature exists and is tested',
        stage_name: 'implementation',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(workflowService.createWorkflowWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workflow-1',
      expect.objectContaining({
        request_id: 'create-wi-successor',
        stage_name: 'implementation',
        parent_work_item_id: parentWorkItemId,
      }),
      client,
    );
  });

  it('defaults parent_work_item_id for cross-stage successor work created from a task.handoff_submitted activation', async () => {
    const parentWorkItemId = '33333333-3333-4333-8333-333333333333';
    const workflowService = {
      createWorkflowWorkItem: vi.fn(async () => ({
        id: 'work-item-review',
        workflow_id: 'workflow-1',
        stage_name: 'review',
        parent_work_item_id: parentWorkItemId,
      })),
    };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'create_work_item', 'create-wi-handoff']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return {
            rowCount: 1,
            rows: [{
              response: {
                id: 'work-item-review',
                workflow_id: 'workflow-1',
                stage_name: 'review',
                parent_work_item_id: parentWorkItemId,
              },
            }],
          };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-create-handoff-successor']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-create-handoff-successor',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: null,
              stage_name: 'implementation',
              activation_id: 'activation-handoff',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workflow_activations wa')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-handoff']);
          return {
            rowCount: 1,
            rows: [{
              lifecycle: 'planned',
              event_type: 'task.handoff_submitted',
              payload: {
                task_id: 'task-developer',
                work_item_id: parentWorkItemId,
                stage_name: 'implementation',
              },
            }],
          };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(async () => client),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', workflowService);
    app.decorate('taskService', { createTask: vi.fn() });
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-create-handoff-successor/work-items',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'create-wi-handoff',
        title: 'Review implementation',
        goal: 'Review implementation output',
        acceptance_criteria: 'Review exists',
        stage_name: 'review',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(workflowService.createWorkflowWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workflow-1',
      expect.objectContaining({
        request_id: 'create-wi-handoff',
        stage_name: 'review',
        parent_work_item_id: parentWorkItemId,
      }),
      client,
    );
  });

  it('defaults parent_work_item_id for cross-stage successor work created from a work_item.updated recovery activation', async () => {
    const parentWorkItemId = '55555555-5555-4555-8555-555555555555';
    const workflowService = {
      createWorkflowWorkItem: vi.fn(async () => ({
        id: 'work-item-fix',
        workflow_id: 'workflow-1',
        stage_name: 'fix',
        parent_work_item_id: parentWorkItemId,
      })),
    };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'create_work_item', 'create-wi-recovery']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return {
            rowCount: 1,
            rows: [{
              response: {
                id: 'work-item-fix',
                workflow_id: 'workflow-1',
                stage_name: 'fix',
                parent_work_item_id: parentWorkItemId,
              },
            }],
          };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-create-recovery-successor']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-create-recovery-successor',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: null,
              stage_name: 'fix',
              activation_id: 'activation-work-item-updated',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workflow_activations wa')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-work-item-updated']);
          return {
            rowCount: 1,
            rows: [{
              lifecycle: 'planned',
              event_type: 'work_item.updated',
              payload: {
                work_item_id: parentWorkItemId,
                previous_stage_name: 'reproduce',
                stage_name: 'reproduce',
              },
            }],
          };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(async () => client),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', workflowService);
    app.decorate('taskService', { createTask: vi.fn() });
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-create-recovery-successor/work-items',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'create-wi-recovery',
        title: 'Fix implementation',
        goal: 'Implement the approved change',
        acceptance_criteria: 'Fix exists and is verified',
        stage_name: 'fix',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(workflowService.createWorkflowWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workflow-1',
      expect.objectContaining({
        request_id: 'create-wi-recovery',
        stage_name: 'fix',
        parent_work_item_id: parentWorkItemId,
      }),
      client,
    );
  });

  it('writes orchestrator memory into an explicitly targeted work-item scope', async () => {
    const workItemId = '11111111-1111-4111-8111-111111111111';
    const workflowService = {
      getWorkflowWorkItem: vi.fn().mockResolvedValue({ id: workItemId }),
    };
    const workspaceService = {
      patchWorkspaceMemory: vi.fn().mockResolvedValue({ key: 'memory-key', work_item_id: workItemId }),
      removeWorkspaceMemory: vi.fn(),
    };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'memory_write', 'memory-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return {
            rowCount: 1,
            rows: [{ response: { key: 'memory-key', work_item_id: workItemId } }],
          };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-memory']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-memory',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: null,
              stage_name: 'requirements',
              activation_id: 'activation-1',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(async () => client),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', workflowService);
    app.decorate('taskService', { createTask: vi.fn() });
    app.decorate('workspaceService', workspaceService);

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-memory/memory',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'memory-1',
        key: 'memory-key',
        value: { summary: 'Scoped to the current work item' },
        work_item_id: workItemId,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(workflowService.getWorkflowWorkItem).toHaveBeenCalledWith(
      'tenant-1',
      'workflow-1',
      workItemId,
    );
    expect(workspaceService.patchWorkspaceMemory).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workspace-1',
      expect.objectContaining({
        key: 'memory-key',
        work_item_id: workItemId,
        context: expect.objectContaining({
          workflow_id: 'workflow-1',
          work_item_id: workItemId,
          task_id: 'task-memory',
        }),
      }),
      client,
    );
  });

  it('accepts design-shaped orchestrator memory updates objects through the replay-safe bridge', async () => {
    const workspaceService = {
      patchWorkspaceMemory: vi.fn(),
      patchWorkspaceMemoryEntries: vi.fn().mockResolvedValue({
        id: 'workspace-1',
        memory: {
          summary: 'Scoped note',
          decision: { outcome: 'ship' },
        },
      }),
      removeWorkspaceMemory: vi.fn(),
    };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'memory_write', 'memory-updates-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return {
            rowCount: 1,
            rows: [{
              response: {
                id: 'workspace-1',
                memory: {
                  summary: 'Scoped note',
                  decision: { outcome: 'ship' },
                },
              },
            }],
          };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-memory']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-memory',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: 'work-item-1',
              stage_name: 'requirements',
              activation_id: 'activation-1',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(async () => client),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { getWorkflowWorkItem: vi.fn(), createWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', { createTask: vi.fn() });
    app.decorate('workspaceService', workspaceService);

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-memory/memory',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'memory-updates-1',
        updates: {
          summary: 'Scoped note',
          decision: { outcome: 'ship' },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(workspaceService.patchWorkspaceMemoryEntries).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workspace-1',
      [
        {
          key: 'summary',
          value: 'Scoped note',
          context: {
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            task_id: 'task-memory',
            stage_name: 'requirements',
          },
        },
        {
          key: 'decision',
          value: { outcome: 'ship' },
          context: {
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            task_id: 'task-memory',
            stage_name: 'requirements',
          },
        },
      ],
      client,
    );
    expect(response.json().data.memory).toEqual({
      summary: 'Scoped note',
      decision: { outcome: 'ship' },
    });
  });

  it('rejects orchestrator memory writes that try to persist workflow status', async () => {
    const workspaceService = {
      patchWorkspaceMemory: vi.fn(),
      patchWorkspaceMemoryEntries: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-memory']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-memory',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: 'work-item-1',
              stage_name: 'requirements',
              activation_id: 'activation-1',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { getWorkflowWorkItem: vi.fn(), createWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', { createTask: vi.fn() });
    app.decorate('workspaceService', workspaceService);

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-memory/memory',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'memory-status-1',
        updates: {
          requirements_gate_status: {
            state: 'awaiting_human_approval',
            checkpoint: 'requirements',
            work_item_id: 'work-item-1',
          },
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    expect(workspaceService.patchWorkspaceMemoryEntries).not.toHaveBeenCalled();
  });

  it('rejects memory_delete without request_id', async () => {
    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', { query: vi.fn(), connect: vi.fn() });
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', { createTask: vi.fn() });
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/orchestrator/tasks/task-memory/memory/memory-key',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('SCHEMA_VALIDATION_FAILED');
  });

  it('updates specialist task input through the idempotent orchestrator bridge', async () => {
    const updatedTask = {
      id: '22222222-2222-4222-8222-222222222222',
      workflow_id: 'workflow-1',
      is_orchestrator_task: false,
      input: { scope: 'narrowed' },
    };
    const taskService = {
      createTask: vi.fn(),
      getTask: vi.fn().mockResolvedValue(updatedTask),
      updateTaskInput: vi.fn().mockResolvedValue(updatedTask),
    };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'update_task_input', 'task-input-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return { rowCount: 1, rows: [{ response: updatedTask }] };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-orchestrator']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-orchestrator',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: 'work-item-1',
              stage_name: 'implementation',
              activation_id: 'activation-1',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(async () => client),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn(), getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', taskService);
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/tasks/22222222-2222-4222-8222-222222222222/input',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'task-input-1',
        input: { scope: 'narrowed' },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(taskService.getTask).toHaveBeenCalledWith('tenant-1', '22222222-2222-4222-8222-222222222222');
    expect(taskService.updateTaskInput).toHaveBeenCalledWith(
      'tenant-1',
      '22222222-2222-4222-8222-222222222222',
      { scope: 'narrowed' },
      client,
    );
    expect(response.json().data).toEqual(updatedTask);
  });

  it('creates a specialist task with the canonical orchestrator contract fields', async () => {
    const workItemId = '11111111-1111-4111-8111-111111111111';
    const createdTask = {
      id: '22222222-2222-4222-8222-222222222222',
      workflow_id: 'workflow-1',
      work_item_id: workItemId,
      stage_name: 'implementation',
      role: 'developer',
      state: 'pending',
      metadata: {},
    };
    const taskService = {
      createTask: vi.fn().mockResolvedValue(createdTask),
    };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'create_task', 'create-task-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return { rowCount: 1, rows: [{ response: createdTask }] };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-orchestrator']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-orchestrator',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: null,
              stage_name: 'implementation',
              activation_id: 'activation-1',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('LEFT JOIN workflow_work_items parent')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', workItemId]);
          return {
            rowCount: 1,
            rows: [{
              id: workItemId,
              stage_name: 'implementation',
              parent_work_item_id: null,
              parent_id: null,
              parent_stage_name: null,
              workflow_lifecycle: 'planned',
            }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workflow_activations wa')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-1']);
          return {
            rowCount: 1,
            rows: [{
              lifecycle: 'planned',
              event_type: null,
              payload: {},
            }],
          };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(async () => client),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn(), getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', taskService);
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/tasks',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'create-task-1',
        title: 'Implement auth flow',
        description: 'Implement the authentication workflow end to end.',
        work_item_id: workItemId,
        stage_name: 'implementation',
        role: 'developer',
        type: 'code',
        credentials: {
          git_token_ref: 'secret:GITHUB_PAT',
        },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(taskService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      expect.objectContaining({
        title: 'Implement auth flow',
        description: 'Implement the authentication workflow end to end.',
        work_item_id: workItemId,
        stage_name: 'implementation',
        role: 'developer',
        type: 'code',
        credentials: {
          git_token_ref: 'secret:GITHUB_PAT',
        },
        metadata: expect.objectContaining({
          created_by_orchestrator_task_id: 'task-orchestrator',
          orchestrator_activation_id: 'activation-1',
        }),
      }),
      client,
    );
    expect(taskService.createTask.mock.calls[0]?.[1]?.capabilities_required).toBeUndefined();
    expect(response.json().data).toEqual(createdTask);
  });

  it('rejects legacy capabilities_required on specialist task creation', async () => {
    const taskService = {
      createTask: vi.fn(),
    };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-orchestrator']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-orchestrator',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: null,
              stage_name: 'implementation',
              activation_id: 'activation-1',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(async () => client),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn(), getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', taskService);
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/tasks',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'create-task-legacy',
        title: 'Legacy task',
        role: 'developer',
        type: 'code',
        capabilities_required: ['coding'],
      },
    });

    expect(response.statusCode).toBe(422);
    expect(taskService.createTask).not.toHaveBeenCalled();
  });

  it('defaults reviewer task linkage from a task.output_pending_assessment activation', async () => {
    const reviewWorkItemId = '22222222-2222-4222-8222-222222222222';
    const createdTask = {
      id: 'task-reviewer',
      workflow_id: 'workflow-1',
      work_item_id: reviewWorkItemId,
      stage_name: 'review',
      role: 'reviewer',
      state: 'pending',
      metadata: {},
    };
    const taskService = {
      createTask: vi.fn().mockResolvedValue(createdTask),
    };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'create_task', 'create-review-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes("COALESCE(metadata->>'subject_task_id'")) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            reviewWorkItemId,
            'reviewer',
            ['pending', 'ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_assessment', 'completed'],
            'task-developer',
            1,
          ]);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return { rowCount: 1, rows: [{ response: createdTask }] };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT input') && sql.includes('FROM tasks')) {
          expect(params).toEqual(['tenant-1', 'task-developer', 'workflow-1']);
          return {
            rowCount: 1,
            rows: [{ input: {} }],
          };
        }
        if (sql.includes('SELECT id, rework_count') && sql.includes('FROM tasks')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-developer']);
          return {
            rowCount: 1,
            rows: [{ id: 'task-developer', rework_count: 0 }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-orchestrator']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-orchestrator',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: 'implementation-item',
              stage_name: 'implementation',
              activation_id: 'activation-review',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('AND workflow_id = $2') && sql.includes('AND id = $3')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-developer']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-developer',
              rework_count: 0,
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('LEFT JOIN workflow_work_items parent')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', reviewWorkItemId]);
          return {
            rowCount: 1,
            rows: [{
              id: reviewWorkItemId,
              stage_name: 'review',
              parent_work_item_id: 'implementation-item',
              parent_id: 'implementation-item',
              parent_stage_name: 'implementation',
              workflow_lifecycle: 'planned',
            }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workflow_activations wa')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-review']);
          return {
            rowCount: 1,
            rows: [{
              lifecycle: 'planned',
              event_type: 'task.output_pending_assessment',
              payload: {
                task_id: 'task-developer',
                work_item_id: 'implementation-item',
              },
            }],
          };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(async () => client),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn(), getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', taskService);
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/tasks',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'create-review-1',
        title: 'Review hello world output',
        description: 'Review the developer-delivered work.',
        work_item_id: reviewWorkItemId,
        stage_name: 'review',
        role: 'reviewer',
        type: 'assessment',
        metadata: { task_kind: 'assessment' },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(taskService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      expect.objectContaining({
        role: 'reviewer',
        input: expect.objectContaining({
          subject_task_id: 'task-developer',
          subject_revision: 1,
        }),
        metadata: expect.objectContaining({
          subject_linkage_source: 'activation_default',
          subject_task_id: 'task-developer',
          subject_revision: 1,
          task_kind: 'assessment',
          created_by_orchestrator_task_id: 'task-orchestrator',
          orchestrator_activation_id: 'activation-review',
        }),
      }),
      client,
    );
    expect(response.json().data).toEqual(createdTask);
  });

  it('returns the existing reviewer task when output_pending_assessment replays for the same reviewed task revision', async () => {
    const reviewWorkItemId = '22222222-2222-4222-8222-222222222222';
    const existingTask = {
      id: 'task-reviewer-existing',
      workflow_id: 'workflow-1',
      work_item_id: reviewWorkItemId,
      stage_name: 'review',
      role: 'reviewer',
      state: 'completed',
      metadata: {
        subject_task_id: 'task-developer',
        subject_revision: 1,
        task_kind: 'assessment',
      },
    };
    const taskService = {
      createTask: vi.fn(),
      getTask: vi.fn().mockResolvedValue(existingTask),
    };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'create_task', 'create-review-duplicate']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes("COALESCE(metadata->>'subject_task_id'")) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            reviewWorkItemId,
            'reviewer',
            ['pending', 'ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_assessment', 'completed'],
            'task-developer',
            1,
          ]);
          return {
            rowCount: 1,
            rows: [{ id: existingTask.id }],
          };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return { rowCount: 1, rows: [{ response: existingTask }] };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT input') && sql.includes('FROM tasks')) {
          expect(params).toEqual(['tenant-1', 'task-developer', 'workflow-1']);
          return {
            rowCount: 1,
            rows: [{ input: {} }],
          };
        }
        if (sql.includes('SELECT id, rework_count') && sql.includes('FROM tasks')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-developer']);
          return {
            rowCount: 1,
            rows: [{ id: 'task-developer', rework_count: 0 }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-orchestrator']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-orchestrator',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: 'implementation-item',
              stage_name: 'implementation',
              activation_id: 'activation-review',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('AND workflow_id = $2') && sql.includes('AND id = $3')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-developer']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-developer',
              rework_count: 0,
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('LEFT JOIN workflow_work_items parent')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', reviewWorkItemId]);
          return {
            rowCount: 1,
            rows: [{
              id: reviewWorkItemId,
              stage_name: 'review',
              parent_work_item_id: 'implementation-item',
              parent_id: 'implementation-item',
              parent_stage_name: 'implementation',
              workflow_lifecycle: 'planned',
            }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workflow_activations wa')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-review']);
          return {
            rowCount: 1,
            rows: [{
              lifecycle: 'planned',
              event_type: 'task.output_pending_assessment',
              payload: {
                task_id: 'task-developer',
                work_item_id: 'implementation-item',
              },
            }],
          };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(async () => client),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn(), getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', taskService);
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/tasks',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'create-review-duplicate',
        title: 'Review hello world output',
        description: 'Review the developer-delivered work.',
        work_item_id: reviewWorkItemId,
        stage_name: 'review',
        role: 'reviewer',
        type: 'assessment',
        metadata: { task_kind: 'assessment' },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(taskService.createTask).not.toHaveBeenCalled();
    expect(taskService.getTask).toHaveBeenCalledWith('tenant-1', existingTask.id);
    expect(response.json().data).toEqual(existingTask);
  });

  it('returns the reopened subject task when assessment_requested_changes already reactivated it', async () => {
    const implementationWorkItemId = '33333333-3333-4333-8333-333333333333';
    const verificationWorkItemId = '44444444-4444-4444-8444-444444444444';
    const existingTask = {
      id: 'task-developer',
      workflow_id: 'workflow-1',
      work_item_id: implementationWorkItemId,
      stage_name: 'implementation',
      role: 'live-test-developer',
      state: 'in_progress',
      metadata: {
        assessment_action: 'request_changes',
      },
    };
    const taskService = {
      createTask: vi.fn(),
      getTask: vi.fn().mockResolvedValue(existingTask),
    };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'create_task', 'create-rework-reuse-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workflow_activations wa')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-rework']);
          return {
            rowCount: 1,
            rows: [{
              lifecycle: 'planned',
              event_type: 'task.assessment_requested_changes',
              payload: {
                task_id: existingTask.id,
                task_role: 'live-test-developer',
                stage_name: 'implementation',
                work_item_id: implementationWorkItemId,
              },
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('AND workflow_id = $2') && sql.includes('AND id = $3')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            existingTask.id,
            'live-test-developer',
            ['pending', 'ready', 'claimed', 'in_progress', 'output_pending_assessment'],
          ]);
          return {
            rowCount: 1,
            rows: [{ id: existingTask.id }],
          };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return { rowCount: 1, rows: [{ response: existingTask }] };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-orchestrator']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-orchestrator',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: implementationWorkItemId,
              stage_name: 'implementation',
              activation_id: 'activation-rework',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('LEFT JOIN workflow_work_items parent')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', verificationWorkItemId]);
          return {
            rowCount: 1,
            rows: [{
              id: verificationWorkItemId,
              stage_name: 'verification',
              parent_work_item_id: 'review-item',
              parent_id: 'review-item',
              parent_stage_name: 'review',
              workflow_lifecycle: 'planned',
            }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workflow_activations wa')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-rework']);
          return {
            rowCount: 1,
            rows: [{
              lifecycle: 'planned',
              event_type: 'task.assessment_requested_changes',
              payload: {
                task_id: existingTask.id,
                task_role: 'live-test-developer',
                stage_name: 'implementation',
                work_item_id: implementationWorkItemId,
              },
            }],
          };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(async () => client),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn(), getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', taskService);
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/tasks',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'create-rework-reuse-1',
        title: 'Add invalid-input stderr coverage and rerun greeting regression suite',
        description: 'Handle QA-requested rework.',
        work_item_id: verificationWorkItemId,
        stage_name: 'verification',
        role: 'live-test-developer',
        type: 'code',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(taskService.createTask).not.toHaveBeenCalled();
    expect(taskService.getTask).toHaveBeenCalledWith('tenant-1', existingTask.id);
    expect(response.json().data).toEqual(existingTask);
  });

  it('defaults verification task reviewed linkage from reviewer activation lineage', async () => {
    const reviewWorkItemId = '22222222-2222-4222-8222-222222222222';
    const verificationWorkItemId = '33333333-3333-4333-8333-333333333333';
    const createdTask = {
      id: 'task-qa',
      workflow_id: 'workflow-1',
      work_item_id: verificationWorkItemId,
      stage_name: 'verification',
      role: 'live-test-qa',
      state: 'pending',
      metadata: {},
    };
    const taskService = {
      createTask: vi.fn().mockResolvedValue(createdTask),
    };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'create_task', 'create-qa-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT id, state, rework_count') && sql.includes('FROM tasks')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-developer']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-developer',
              state: 'completed',
              rework_count: 0,
            }],
          };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return { rowCount: 1, rows: [{ response: createdTask }] };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          if (params?.[1] === 'task-orchestrator') {
            expect(params).toEqual(['tenant-1', 'task-orchestrator']);
            return {
              rowCount: 1,
              rows: [{
                id: 'task-orchestrator',
                workflow_id: 'workflow-1',
                workspace_id: 'workspace-1',
                work_item_id: reviewWorkItemId,
                stage_name: 'review',
                activation_id: 'activation-handoff-review',
                assigned_agent_id: 'agent-1',
                is_orchestrator_task: true,
                state: 'in_progress',
              }],
            };
          }
          if (params?.[1] === 'task-reviewer') {
            expect(params).toEqual(['tenant-1', 'task-reviewer', 'workflow-1']);
            return {
              rowCount: 1,
              rows: [{
                id: 'task-reviewer',
                workflow_id: 'workflow-1',
                role: 'live-test-reviewer',
                input: {
                  subject_task_id: 'task-developer',
                  subject_revision: 1,
                },
              }],
            };
          }
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('LEFT JOIN workflow_work_items parent')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', reviewWorkItemId]);
          return {
            rowCount: 1,
            rows: [{
              id: reviewWorkItemId,
              stage_name: 'review',
              parent_work_item_id: 'implementation-item',
              parent_id: 'implementation-item',
              parent_stage_name: 'implementation',
              workflow_lifecycle: 'planned',
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('parent_work_item_id = $3') && sql.includes('stage_name = $4')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', reviewWorkItemId, 'verification']);
          return {
            rowCount: 1,
            rows: [{ id: verificationWorkItemId }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workflow_activations wa')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-handoff-review']);
          return {
            rowCount: 1,
            rows: [{
              lifecycle: 'planned',
              event_type: 'task.handoff_submitted',
              payload: {
                task_id: 'task-reviewer',
                work_item_id: reviewWorkItemId,
                stage_name: 'review',
              },
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('AND workflow_id = $2') && sql.includes('AND id = $3')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-developer']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-developer',
              rework_count: 0,
            }],
          };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(async () => client),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn(), getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', taskService);
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/tasks',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'create-qa-1',
        title: 'Validate hello world output',
        description: 'Validate the reviewer-approved work.',
        work_item_id: reviewWorkItemId,
        stage_name: 'verification',
        role: 'live-test-qa',
        type: 'test',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(taskService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      expect.objectContaining({
        work_item_id: verificationWorkItemId,
        role: 'live-test-qa',
        type: 'test',
        input: expect.objectContaining({
          subject_task_id: 'task-developer',
          subject_revision: 1,
        }),
        metadata: expect.objectContaining({
          subject_task_id: 'task-developer',
          subject_revision: 1,
          subject_linkage_source: 'activation_lineage_default',
          stage_aligned_work_item_id_source: 'child_stage_match',
          created_by_orchestrator_task_id: 'task-orchestrator',
          orchestrator_activation_id: 'activation-handoff-review',
        }),
      }),
      client,
    );
    expect(response.json().data).toEqual(createdTask);
  });

  it('returns a structured no-op when verification is requested before the subject task is ready', async () => {
    const verificationWorkItemId = '55555555-5555-4555-8555-555555555555';
    const taskService = {
      createTask: vi.fn(),
    };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'create_task', 'create-qa-not-ready']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT id, state, rework_count') && sql.includes('FROM tasks')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-developer']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-developer',
              state: 'output_pending_assessment',
              rework_count: 1,
            }],
          };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          expect(params?.[5]).toBe('recoverable_not_applied');
          expect(params?.[6]).toBe('subject_task_not_ready');
          expect(params?.[4]).toMatchObject({
            mutation_outcome: 'recoverable_not_applied',
            recovery_class: 'subject_task_not_ready',
            closure_still_possible: true,
          });
          return {
            rowCount: 1,
            rows: [{
              response: params?.[4],
            }],
          };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-orchestrator']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-orchestrator',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: verificationWorkItemId,
              stage_name: 'verification',
              activation_id: 'activation-qa-stale',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('LEFT JOIN workflow_work_items parent')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', verificationWorkItemId]);
          return {
            rowCount: 1,
            rows: [{
              id: verificationWorkItemId,
              stage_name: 'verification',
              parent_work_item_id: 'review-item',
              parent_id: 'review-item',
              parent_stage_name: 'review',
              workflow_lifecycle: 'planned',
            }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workflow_activations wa')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-qa-stale']);
          return {
            rowCount: 1,
            rows: [{
              lifecycle: 'planned',
              event_type: 'task.handoff_submitted',
              payload: {
                task_id: 'task-reviewer',
                work_item_id: 'review-item',
                stage_name: 'review',
              },
            }],
          };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(async () => client),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn(), getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', taskService);
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/tasks',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'create-qa-not-ready',
        title: 'Validate the reviewed implementation',
        description: 'Run QA only after the reviewed work is ready.',
        work_item_id: verificationWorkItemId,
        stage_name: 'verification',
        role: 'live-test-qa',
        type: 'test',
        input: {
          subject_task_id: 'task-developer',
          subject_revision: 1,
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(taskService.createTask).not.toHaveBeenCalled();
    expect(response.json().data).toEqual(
      expect.objectContaining({
        mutation_outcome: 'recoverable_not_applied',
        recovery_class: 'subject_task_not_ready',
        noop: true,
        ready: false,
        reason_code: 'subject_task_not_ready',
        work_item_id: verificationWorkItemId,
        stage_name: 'verification',
        subject_task_id: 'task-developer',
        subject_task_revision: 1,
        subject_task_state: 'output_pending_assessment',
      }),
    );
  });

  it('returns a structured no-op when an assessment request was already applied to the triggering task', async () => {
    const implementationWorkItemId = '44444444-4444-4444-8444-444444444444';
    const verificationWorkItemId = '55555555-5555-4555-8555-555555555555';
    const taskService = {
      createTask: vi.fn(),
    };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'create_task', 'create-qa-rework-duplicate']);
          return { rowCount: 0, rows: [] };
        }
        if (
          sql.includes('SELECT id, role, work_item_id, stage_name, metadata')
          && sql.includes('FROM tasks')
        ) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-developer']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-developer',
              role: 'live-test-developer',
              work_item_id: implementationWorkItemId,
              stage_name: 'implementation',
              metadata: {
                last_applied_assessment_request_task_id: 'task-qa',
                last_applied_assessment_request_handoff_id: 'handoff-qa-1',
              },
            }],
          };
        }
        if (
          sql.includes('SELECT id, work_item_id, stage_name')
          && sql.includes('FROM tasks')
        ) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-qa']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-qa',
              work_item_id: verificationWorkItemId,
              stage_name: 'verification',
            }],
          };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          expect(params?.[5]).toBe('recoverable_not_applied');
          expect(params?.[6]).toBe('assessment_request_already_applied');
          expect(params?.[4]).toMatchObject({
            mutation_outcome: 'recoverable_not_applied',
            recovery_class: 'assessment_request_already_applied',
            closure_still_possible: true,
          });
          return {
            rowCount: 1,
            rows: [{
              response: params?.[4],
            }],
          };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT input') && sql.includes('FROM tasks')) {
          expect(params).toEqual(['tenant-1', 'task-developer', 'workflow-1']);
          return {
            rowCount: 1,
            rows: [{ input: {} }],
          };
        }
        if (sql.includes('SELECT id, rework_count') && sql.includes('FROM tasks')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-developer']);
          return {
            rowCount: 1,
            rows: [{ id: 'task-developer', rework_count: 0 }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-orchestrator']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-orchestrator',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: implementationWorkItemId,
              stage_name: 'implementation',
              activation_id: 'activation-dev-output',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('LEFT JOIN workflow_work_items parent')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', verificationWorkItemId]);
          return {
            rowCount: 1,
            rows: [{
              id: verificationWorkItemId,
              stage_name: 'verification',
              parent_work_item_id: 'review-item',
              parent_id: 'review-item',
              parent_stage_name: 'review',
              workflow_lifecycle: 'planned',
            }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workflow_activations wa')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-dev-output']);
          return {
            rowCount: 1,
            rows: [{
              lifecycle: 'planned',
              event_type: 'task.output_pending_assessment',
              payload: {
                task_id: 'task-developer',
                task_role: 'live-test-developer',
                work_item_id: implementationWorkItemId,
                stage_name: 'implementation',
              },
            }],
          };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(async () => client),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn(), getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', taskService);
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/tasks',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'create-qa-rework-duplicate',
        title: 'Address QA findings for greeting CLI verification',
        description: 'Implement QA-requested rework after the developer task was already reopened.',
        work_item_id: verificationWorkItemId,
        stage_name: 'verification',
        role: 'live-test-developer',
        type: 'code',
        input: {
          qa_findings: ['Tighten invalid invocation assertions.'],
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(taskService.createTask).not.toHaveBeenCalled();
    expect(response.json().data).toEqual(
      expect.objectContaining({
        mutation_outcome: 'recoverable_not_applied',
        recovery_class: 'assessment_request_already_applied',
        noop: true,
        ready: false,
        reason_code: 'assessment_request_already_applied',
        work_item_id: verificationWorkItemId,
        stage_name: 'verification',
        subject_task_id: 'task-developer',
        subject_task_stage_name: 'implementation',
        assessment_request_task_id: 'task-qa',
        assessment_request_work_item_id: verificationWorkItemId,
        assessment_request_stage_name: 'verification',
      }),
    );
  });

  it('rebinds create_task to the unique child work item in the requested stage for planned workflows', async () => {
    const predecessorWorkItemId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const approvalWorkItemId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const createdTask = {
      id: 'task-approval-pm',
      workflow_id: 'workflow-1',
      work_item_id: approvalWorkItemId,
      stage_name: 'approval',
      role: 'product-manager',
      state: 'pending',
      metadata: {},
    };
    const taskService = {
      createTask: vi.fn().mockResolvedValue(createdTask),
    };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'create_task', 'create-approval-task-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return { rowCount: 1, rows: [{ response: createdTask }] };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-orchestrator']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-orchestrator',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: predecessorWorkItemId,
              stage_name: 'technical-review',
              activation_id: 'activation-approval',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('LEFT JOIN workflow_work_items parent')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', predecessorWorkItemId]);
          return {
            rowCount: 1,
            rows: [{
              id: predecessorWorkItemId,
              stage_name: 'technical-review',
              parent_work_item_id: null,
              parent_stage_name: null,
              parent_id: null,
              workflow_lifecycle: 'planned',
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('parent_work_item_id = $3') && sql.includes('stage_name = $4')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', predecessorWorkItemId, 'approval']);
          return {
            rowCount: 1,
            rows: [{ id: approvalWorkItemId }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workflow_activations wa')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-approval']);
          return {
            rowCount: 1,
            rows: [{
              lifecycle: 'planned',
              event_type: null,
              payload: {},
            }],
          };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(async () => client),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn(), getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', taskService);
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/tasks',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'create-approval-task-1',
        title: 'Prepare approval package',
        description: 'Revise the PRD and prepare it for approval.',
        work_item_id: predecessorWorkItemId,
        stage_name: 'approval',
        role: 'product-manager',
        type: 'docs',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(taskService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      expect.objectContaining({
        work_item_id: approvalWorkItemId,
        stage_name: 'approval',
        metadata: expect.objectContaining({
          stage_aligned_work_item_id_source: 'child_stage_match',
          created_by_orchestrator_task_id: 'task-orchestrator',
          orchestrator_activation_id: 'activation-approval',
        }),
      }),
      client,
    );
    expect(response.json().data).toEqual(createdTask);
  });

  it('defaults custom assessment-role linkage from a task.handoff_submitted activation when task type is assessment', async () => {
    const reviewWorkItemId = '44444444-4444-4444-8444-444444444444';
    const createdTask = {
      id: 'task-custom-reviewer',
      workflow_id: 'workflow-1',
      work_item_id: reviewWorkItemId,
      stage_name: 'review',
      role: 'live-test-reviewer',
      state: 'pending',
      metadata: {},
    };
    const taskService = {
      createTask: vi.fn().mockResolvedValue(createdTask),
    };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'create_task', 'create-custom-review-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes("COALESCE(metadata->>'subject_task_id'")) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            reviewWorkItemId,
            'live-test-reviewer',
            ['pending', 'ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_assessment', 'completed'],
            'task-developer',
            1,
          ]);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return { rowCount: 1, rows: [{ response: createdTask }] };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM task_handoffs th') && sql.includes("COALESCE(th.role_data->>'task_kind', 'delivery') = 'delivery'")) {
          expect(params).toEqual(['tenant-1', 'workflow-1', reviewWorkItemId]);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-orchestrator']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-orchestrator',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: 'implementation-item',
              stage_name: 'implementation',
              activation_id: 'activation-handoff-review',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('LEFT JOIN workflow_work_items parent')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', reviewWorkItemId]);
          return {
            rowCount: 1,
            rows: [{
              id: reviewWorkItemId,
              stage_name: 'review',
              parent_work_item_id: 'implementation-item',
              parent_id: 'implementation-item',
              parent_stage_name: 'implementation',
              workflow_lifecycle: 'planned',
            }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workflow_activations wa')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-handoff-review']);
          return {
            rowCount: 1,
            rows: [{
              lifecycle: 'planned',
              event_type: 'task.handoff_submitted',
              payload: {
                task_id: 'task-developer',
                work_item_id: 'implementation-item',
                stage_name: 'implementation',
              },
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('AND workflow_id = $2') && sql.includes('AND id = $3')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-developer']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-developer',
              rework_count: 0,
            }],
          };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(async () => client),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn(), getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', taskService);
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/tasks',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'create-custom-review-1',
        title: 'Review hello world output',
        description: 'Review the developer-delivered work.',
        work_item_id: reviewWorkItemId,
        stage_name: 'review',
        role: 'live-test-reviewer',
        type: 'assessment',
        metadata: { task_kind: 'assessment' },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(taskService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      expect.objectContaining({
        role: 'live-test-reviewer',
        type: 'assessment',
        input: expect.objectContaining({
          subject_task_id: 'task-developer',
          subject_revision: 1,
        }),
        metadata: expect.objectContaining({
          subject_linkage_source: 'activation_default',
          subject_task_id: 'task-developer',
          subject_revision: 1,
          task_kind: 'assessment',
          created_by_orchestrator_task_id: 'task-orchestrator',
          orchestrator_activation_id: 'activation-handoff-review',
        }),
      }),
      client,
    );
    expect(response.json().data).toEqual(createdTask);
  });

  it('defaults assessment linkage to the activating delivery task on task.handoff_submitted when only the public task type is set', async () => {
    const assessmentWorkItemId = '55555555-5555-4555-8555-555555555555';
    const createdTask = {
      id: 'task-acceptance-assessor',
      workflow_id: 'workflow-1',
      work_item_id: assessmentWorkItemId,
      stage_name: 'implementation',
      role: 'acceptance-gate-assessor',
      state: 'pending',
      metadata: {},
    };
    const taskService = {
      createTask: vi.fn().mockResolvedValue(createdTask),
    };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'create_task', 'create-assessment-fix-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes("COALESCE(metadata->>'subject_task_id'")) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            assessmentWorkItemId,
            'acceptance-gate-assessor',
            ['pending', 'ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_assessment', 'completed'],
            'task-implementer',
            1,
          ]);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return { rowCount: 1, rows: [{ response: createdTask }] };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM task_handoffs th') && sql.includes("COALESCE(th.role_data->>'task_kind', 'delivery') = 'delivery'")) {
          expect(params).toEqual(['tenant-1', 'workflow-1', assessmentWorkItemId]);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT input, metadata') && sql.includes('FROM tasks')) {
          expect(params).toEqual(['tenant-1', 'task-implementer', 'workflow-1']);
          return {
            rowCount: 1,
            rows: [{
              input: { subject_task_id: 'task-architect' },
              metadata: { task_kind: 'delivery' },
              is_orchestrator_task: false,
            }],
          };
        }
        if (sql.includes('SELECT id, rework_count') && sql.includes('FROM tasks')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-implementer']);
          return {
            rowCount: 1,
            rows: [{ id: 'task-implementer', rework_count: 0 }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-orchestrator']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-orchestrator',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: 'implementation-item',
              stage_name: 'implementation',
              activation_id: 'activation-assessment',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('LEFT JOIN workflow_work_items parent')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', assessmentWorkItemId]);
          return {
            rowCount: 1,
            rows: [{
              id: assessmentWorkItemId,
              stage_name: 'implementation',
              parent_work_item_id: 'implementation-item',
              parent_id: 'implementation-item',
              parent_stage_name: 'implementation',
              workflow_lifecycle: 'planned',
            }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workflow_activations wa')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-assessment']);
          return {
            rowCount: 1,
            rows: [{
              lifecycle: 'planned',
              event_type: 'task.handoff_submitted',
              payload: {
                task_id: 'task-implementer',
                work_item_id: 'implementation-item',
                stage_name: 'implementation',
              },
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('AND workflow_id = $2') && sql.includes('AND id = $3')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-implementer']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-implementer',
              rework_count: 0,
            }],
          };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(async () => client),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn(), getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', taskService);
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/tasks',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'create-assessment-fix-1',
        title: 'Assess implementation output',
        description: 'Assess the implementation deliverable after handoff submission.',
        work_item_id: assessmentWorkItemId,
        stage_name: 'implementation',
        role: 'acceptance-gate-assessor',
        type: 'assessment',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(taskService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      expect.objectContaining({
        role: 'acceptance-gate-assessor',
        type: 'assessment',
        input: expect.objectContaining({
          subject_task_id: 'task-implementer',
          subject_revision: 1,
        }),
        metadata: expect.objectContaining({
          subject_linkage_source: 'activation_default',
          subject_task_id: 'task-implementer',
          subject_revision: 1,
          created_by_orchestrator_task_id: 'task-orchestrator',
          orchestrator_activation_id: 'activation-assessment',
        }),
      }),
      client,
    );
    expect(response.json().data).toEqual(createdTask);
  });

  it('accepts top-level assessment subject_revision and preserves it through activation-default linkage', async () => {
    const assessmentWorkItemId = '56565656-5656-4565-8565-565656565656';
    const createdTask = {
      id: 'task-acceptance-assessor-top-level',
      workflow_id: 'workflow-1',
      work_item_id: assessmentWorkItemId,
      stage_name: 'implementation',
      role: 'acceptance-gate-assessor',
      state: 'pending',
      metadata: {},
    };
    const taskService = {
      createTask: vi.fn().mockResolvedValue(createdTask),
    };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'create_task', 'create-assessment-top-level-revision-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes("COALESCE(metadata->>'subject_task_id'")) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            assessmentWorkItemId,
            'acceptance-gate-assessor',
            ['pending', 'ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_assessment', 'completed'],
            'task-implementer',
            7,
          ]);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return { rowCount: 1, rows: [{ response: createdTask }] };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM task_handoffs th') && sql.includes("COALESCE(th.role_data->>'task_kind', 'delivery') = 'delivery'")) {
          expect(params).toEqual(['tenant-1', 'workflow-1', assessmentWorkItemId]);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT input, metadata') && sql.includes('FROM tasks')) {
          expect(params).toEqual(['tenant-1', 'task-implementer', 'workflow-1']);
          return {
            rowCount: 1,
            rows: [{
              input: { subject_task_id: 'task-architect' },
              metadata: { task_kind: 'delivery' },
              is_orchestrator_task: false,
            }],
          };
        }
        if (sql.includes('SELECT id, rework_count') && sql.includes('FROM tasks')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-implementer']);
          return {
            rowCount: 1,
            rows: [{ id: 'task-implementer', rework_count: 0 }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-orchestrator']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-orchestrator',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: 'implementation-item',
              stage_name: 'implementation',
              activation_id: 'activation-assessment-top-level',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('LEFT JOIN workflow_work_items parent')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', assessmentWorkItemId]);
          return {
            rowCount: 1,
            rows: [{
              id: assessmentWorkItemId,
              stage_name: 'implementation',
              parent_work_item_id: 'implementation-item',
              parent_id: 'implementation-item',
              parent_stage_name: 'implementation',
              workflow_lifecycle: 'planned',
            }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workflow_activations wa')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-assessment-top-level']);
          return {
            rowCount: 1,
            rows: [{
              lifecycle: 'planned',
              event_type: 'task.handoff_submitted',
              payload: {
                task_id: 'task-implementer',
                work_item_id: 'implementation-item',
                stage_name: 'implementation',
              },
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('AND workflow_id = $2') && sql.includes('AND id = $3')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-implementer']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-implementer',
              rework_count: 0,
            }],
          };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(async () => client),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn(), getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', taskService);
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/tasks',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'create-assessment-top-level-revision-1',
        title: 'Assess implementation output with explicit revision',
        description: 'Assess the implementation deliverable after handoff submission.',
        work_item_id: assessmentWorkItemId,
        stage_name: 'implementation',
        role: 'acceptance-gate-assessor',
        type: 'assessment',
        subject_revision: 7,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(taskService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      expect.objectContaining({
        role: 'acceptance-gate-assessor',
        type: 'assessment',
        input: expect.objectContaining({
          subject_task_id: 'task-implementer',
          subject_revision: 7,
        }),
        metadata: expect.objectContaining({
          subject_linkage_source: 'activation_default',
          subject_task_id: 'task-implementer',
          subject_revision: 7,
          created_by_orchestrator_task_id: 'task-orchestrator',
          orchestrator_activation_id: 'activation-assessment-top-level',
        }),
      }),
      client,
    );
    expect(response.json().data).toEqual(createdTask);
  });

  it('derives subject_revision for explicit assessment subject_task_id linkage', async () => {
    const db = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT id, rework_count, input, metadata, is_orchestrator_task') && sql.includes('FROM tasks')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-implementer']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-implementer',
              rework_count: 2,
              input: { description: 'Implement revision 3 release-ready contract.' },
              metadata: { task_kind: 'delivery', description: 'Implement revision 3 release-ready contract.' },
              is_orchestrator_task: false,
            }],
          };
        }
        throw new Error(`unexpected db query: ${sql}`);
      }),
    };

    const normalized = await normalizeExplicitAssessmentSubjectTaskLinkage(
      db as never,
      'tenant-1',
      'workflow-1',
      {
        request_id: 'create-assessment-explicit-subject-1',
        title: 'Assess implementation output with explicit subject',
        description: 'Assess the explicit subject task after rework.',
        work_item_id: '5a5a5a5a-5a5a-45a5-85a5-5a5a5a5a5a5a',
        stage_name: 'implementation',
        role: 'acceptance-gate-assessor',
        type: 'assessment',
        input: {
          subject_task_id: 'task-implementer',
        },
      },
    );

    expect(normalized.input).toMatchObject({
      subject_task_id: 'task-implementer',
      subject_revision: 3,
    });
    expect(normalized.metadata).toMatchObject({
      subject_linkage_source: 'explicit_subject_task_default',
      subject_task_id: 'task-implementer',
      subject_revision: 3,
    });
  });

  it('rebinds activation-default assessment linkage through an assessment task to its explicit subject', async () => {
    const assessmentWorkItemId = '57575757-5757-4575-8575-575757575757';
    const createdTask = {
      id: 'task-acceptance-assessor-rebound',
      workflow_id: 'workflow-1',
      work_item_id: assessmentWorkItemId,
      stage_name: 'implementation',
      role: 'acceptance-gate-assessor',
      state: 'pending',
      metadata: {},
    };
    const taskService = {
      createTask: vi.fn().mockResolvedValue(createdTask),
    };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'create_task', 'create-assessment-rebound-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes("COALESCE(metadata->>'subject_task_id'")) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            assessmentWorkItemId,
            'acceptance-gate-assessor',
            ['pending', 'ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_assessment', 'completed'],
            'task-implementer',
            2,
          ]);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return { rowCount: 1, rows: [{ response: createdTask }] };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM task_handoffs th') && sql.includes("COALESCE(th.role_data->>'task_kind', 'delivery') = 'delivery'")) {
          expect(params).toEqual(['tenant-1', 'workflow-1', assessmentWorkItemId]);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT id, rework_count, input, metadata, is_orchestrator_task') && sql.includes('FROM tasks')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-assessor-1']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-assessor-1',
              rework_count: 0,
              input: {
                subject_task_id: 'task-implementer',
                subject_revision: 2,
              },
              metadata: {
                task_kind: 'assessment',
                subject_task_id: 'task-implementer',
                subject_revision: 2,
              },
              is_orchestrator_task: false,
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-orchestrator']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-orchestrator',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: 'implementation-item',
              stage_name: 'implementation',
              activation_id: 'activation-assessment-rebound',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('LEFT JOIN workflow_work_items parent')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', assessmentWorkItemId]);
          return {
            rowCount: 1,
            rows: [{
              id: assessmentWorkItemId,
              stage_name: 'implementation',
              parent_work_item_id: 'implementation-item',
              parent_id: 'implementation-item',
              parent_stage_name: 'implementation',
              workflow_lifecycle: 'planned',
            }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workflow_activations wa')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-assessment-rebound']);
          return {
            rowCount: 1,
            rows: [{
              lifecycle: 'planned',
              event_type: 'task.handoff_submitted',
              payload: {
                task_id: 'task-assessor-1',
                work_item_id: assessmentWorkItemId,
                stage_name: 'implementation',
              },
            }],
          };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(async () => client),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn(), getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', taskService);
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/tasks',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'create-assessment-rebound-1',
        title: 'Reassess implementation output',
        description: 'Reassess the implementation deliverable after rework.',
        work_item_id: assessmentWorkItemId,
        stage_name: 'implementation',
        role: 'acceptance-gate-assessor',
        type: 'assessment',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(taskService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      expect.objectContaining({
        role: 'acceptance-gate-assessor',
        type: 'assessment',
        input: expect.objectContaining({
          subject_task_id: 'task-implementer',
          subject_revision: 2,
        }),
        metadata: expect.objectContaining({
          subject_linkage_source: 'activation_default',
          subject_task_id: 'task-implementer',
          subject_revision: 2,
          created_by_orchestrator_task_id: 'task-orchestrator',
          orchestrator_activation_id: 'activation-assessment-rebound',
        }),
      }),
      client,
    );
    expect(response.json().data).toEqual(createdTask);
  });

  it('rebinds assessment linkage to the target work item delivery subject on cross-stage handoff activations', async () => {
    const implementationWorkItemId = '66666666-6666-4666-8666-666666666666';
    const createdTask = {
      id: 'task-quality-assessor',
      workflow_id: 'workflow-1',
      work_item_id: implementationWorkItemId,
      stage_name: 'implementation',
      role: 'delivery-quality-assessor',
      state: 'pending',
      metadata: {},
    };
    const taskService = {
      createTask: vi.fn().mockResolvedValue(createdTask),
    };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'create_task', 'create-cross-stage-assessment-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes("COALESCE(metadata->>'subject_task_id'")) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            implementationWorkItemId,
            'delivery-quality-assessor',
            ['pending', 'ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_assessment', 'completed'],
            'task-implementer',
            1,
          ]);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return { rowCount: 1, rows: [{ response: createdTask }] };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM task_handoffs') && sql.includes('role_data->>\'subject_task_id\'')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', implementationWorkItemId]);
          return {
            rowCount: 1,
            rows: [{
              subject_task_id: 'task-implementer',
              subject_work_item_id: implementationWorkItemId,
              subject_revision: 1,
            }],
          };
        }
        if (sql.includes('SELECT id, rework_count') && sql.includes('FROM tasks')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-implementer']);
          return {
            rowCount: 1,
            rows: [{ id: 'task-implementer', rework_count: 0 }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-orchestrator']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-orchestrator',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: 'design-item',
              stage_name: 'design',
              activation_id: 'activation-design-handoff',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('LEFT JOIN workflow_work_items parent')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', implementationWorkItemId]);
          return {
            rowCount: 1,
            rows: [{
              id: implementationWorkItemId,
              stage_name: 'implementation',
              parent_work_item_id: 'design-item',
              parent_id: 'design-item',
              parent_stage_name: 'design',
              workflow_lifecycle: 'planned',
            }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workflow_activations wa')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-design-handoff']);
          return {
            rowCount: 1,
            rows: [{
              lifecycle: 'planned',
              event_type: 'task.handoff_submitted',
              payload: {
                task_id: 'task-architect',
                work_item_id: 'design-item',
                stage_name: 'design',
              },
            }],
          };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(async () => client),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn(), getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', taskService);
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/tasks',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'create-cross-stage-assessment-1',
        title: 'Assess packaged delivery output',
        description: 'Assess the implementation deliverable after the prior stage handoff.',
        work_item_id: implementationWorkItemId,
        stage_name: 'implementation',
        role: 'delivery-quality-assessor',
        type: 'assessment',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(taskService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      expect.objectContaining({
        role: 'delivery-quality-assessor',
        type: 'assessment',
        input: expect.objectContaining({
          subject_task_id: 'task-implementer',
          subject_revision: 1,
        }),
        metadata: expect.objectContaining({
          subject_linkage_source: 'target_work_item_delivery_default',
          subject_task_id: 'task-implementer',
          subject_revision: 1,
          created_by_orchestrator_task_id: 'task-orchestrator',
          orchestrator_activation_id: 'activation-design-handoff',
        }),
      }),
      client,
    );
    expect(response.json().data).toEqual(createdTask);
  });

  it('infers assessment task type from the work-item expectation when create_task omits type', async () => {
    const implementationWorkItemId = '77777777-7777-4777-8777-777777777777';
    const createdTask = {
      id: 'task-quality-assessor',
      workflow_id: 'workflow-1',
      work_item_id: implementationWorkItemId,
      stage_name: 'implementation',
      role: 'delivery-quality-assessor',
      state: 'pending',
      metadata: {},
    };
    const taskService = {
      createTask: vi.fn().mockResolvedValue(createdTask),
    };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'create_task', 'create-inferred-assessment-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes("COALESCE(metadata->>'subject_task_id'")) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            implementationWorkItemId,
            'delivery-quality-assessor',
            ['pending', 'ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_assessment', 'completed'],
            'task-implementer',
            1,
          ]);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return { rowCount: 1, rows: [{ response: createdTask }] };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT next_expected_actor, next_expected_action')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', implementationWorkItemId]);
          return {
            rowCount: 1,
            rows: [{
              next_expected_actor: 'delivery-quality-assessor',
              next_expected_action: 'assess',
            }],
          };
        }
        if (sql.includes('FROM task_handoffs') && sql.includes('role_data->>\'subject_task_id\'')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', implementationWorkItemId]);
          return {
            rowCount: 1,
            rows: [{
              subject_task_id: 'task-implementer',
              subject_work_item_id: implementationWorkItemId,
              subject_revision: 1,
            }],
          };
        }
        if (sql.includes('SELECT id, rework_count') && sql.includes('FROM tasks')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-implementer']);
          return {
            rowCount: 1,
            rows: [{ id: 'task-implementer', rework_count: 0 }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-orchestrator']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-orchestrator',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: 'design-item',
              stage_name: 'design',
              activation_id: 'activation-design-handoff',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('LEFT JOIN workflow_work_items parent')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', implementationWorkItemId]);
          return {
            rowCount: 1,
            rows: [{
              id: implementationWorkItemId,
              stage_name: 'implementation',
              parent_work_item_id: 'design-item',
              parent_id: 'design-item',
              parent_stage_name: 'design',
              workflow_lifecycle: 'planned',
            }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workflow_activations wa')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-design-handoff']);
          return {
            rowCount: 1,
            rows: [{
              lifecycle: 'planned',
              event_type: 'task.handoff_submitted',
              payload: {
                task_id: 'task-architect',
                work_item_id: 'design-item',
                stage_name: 'design',
              },
            }],
          };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(async () => client),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn(), getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', taskService);
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/tasks',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'create-inferred-assessment-1',
        title: 'Assess packaged delivery output',
        description: 'Assess the implementation deliverable after the prior stage handoff.',
        work_item_id: implementationWorkItemId,
        stage_name: 'implementation',
        role: 'delivery-quality-assessor',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(taskService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      expect.objectContaining({
        role: 'delivery-quality-assessor',
        type: 'assessment',
        input: expect.objectContaining({
          subject_task_id: 'task-implementer',
          subject_revision: 1,
        }),
        metadata: expect.objectContaining({
          subject_linkage_source: 'target_work_item_delivery_default',
          subject_task_id: 'task-implementer',
          subject_revision: 1,
          created_by_orchestrator_task_id: 'task-orchestrator',
          orchestrator_activation_id: 'activation-design-handoff',
        }),
      }),
      client,
    );
    expect(response.json().data).toEqual(createdTask);
  });

  it('rejects create_task when canonical required fields are missing', async () => {
    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', { query: vi.fn(), connect: vi.fn() });
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn(), getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', { createTask: vi.fn() });
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/tasks',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'create-task-2',
        title: 'Implement auth flow',
        work_item_id: '11111111-1111-4111-8111-111111111111',
        role: 'developer',
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('SCHEMA_VALIDATION_FAILED');
  });

  it('approves a specialist task through the replay-safe orchestrator bridge', async () => {
    const approvedTask = {
      id: '22222222-2222-4222-8222-222222222222',
      workflow_id: 'workflow-1',
      is_orchestrator_task: false,
      state: 'awaiting_approval',
    };
    const taskService = {
      createTask: vi.fn(),
      getTask: vi.fn().mockResolvedValue(approvedTask),
      approveTask: vi.fn().mockResolvedValue(approvedTask),
    };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'approve_task', 'approve-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return { rowCount: 1, rows: [{ response: approvedTask }] };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-orchestrator']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-orchestrator',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: 'work-item-1',
              stage_name: 'implementation',
              activation_id: 'activation-1',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(async () => client),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn(), getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', taskService);
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/tasks/22222222-2222-4222-8222-222222222222/approve',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'approve-1',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(taskService.approveTask).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      '22222222-2222-4222-8222-222222222222',
      client,
    );
    expect(response.json().data).toEqual(approvedTask);
  });

  it('returns a recoverable noop when approving a specialist task that is no longer awaiting approval', async () => {
    const managedTask = {
      id: '22222222-2222-4222-8222-222222222222',
      workflow_id: 'workflow-1',
      work_item_id: 'work-item-1',
      stage_name: 'implementation',
      is_orchestrator_task: false,
      state: 'output_pending_assessment',
    };
    const taskService = {
      createTask: vi.fn(),
      getTask: vi.fn().mockResolvedValue(managedTask),
      approveTask: vi.fn(),
    };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'approve_task', 'approve-stale-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          expect(params?.[5]).toBe('recoverable_not_applied');
          expect(params?.[6]).toBe('task_not_awaiting_approval');
          expect(params?.[4]).toMatchObject({
            mutation_outcome: 'recoverable_not_applied',
            recovery_class: 'task_not_awaiting_approval',
            closure_still_possible: true,
          });
          return {
            rowCount: 1,
            rows: [{
              response: params?.[4],
            }],
          };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-orchestrator']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-orchestrator',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: 'work-item-1',
              stage_name: 'implementation',
              activation_id: 'activation-1',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(async () => client),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn(), getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', taskService);
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/tasks/22222222-2222-4222-8222-222222222222/approve',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'approve-stale-1',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(taskService.approveTask).not.toHaveBeenCalled();
    expect(response.json().data).toMatchObject({
      mutation_outcome: 'recoverable_not_applied',
      recovery_class: 'task_not_awaiting_approval',
      noop: true,
      ready: false,
      reason_code: 'task_not_awaiting_approval',
      task_id: '22222222-2222-4222-8222-222222222222',
      task_state: 'output_pending_assessment',
    });
  });

  it('escalates a specialist task to human review through the replay-safe orchestrator bridge', async () => {
    const escalatedTask = {
      id: '22222222-2222-4222-8222-222222222222',
      workflow_id: 'workflow-1',
      is_orchestrator_task: false,
      state: 'escalated',
    };
    const taskService = {
      createTask: vi.fn(),
      getTask: vi.fn().mockResolvedValue(escalatedTask),
      escalateTask: vi.fn().mockResolvedValue(escalatedTask),
    };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'escalate_to_human', 'escalate-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return { rowCount: 1, rows: [{ response: escalatedTask }] };
        }
        throw new Error(`unexpected client query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-orchestrator']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-orchestrator',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: 'work-item-1',
              stage_name: 'implementation',
              activation_id: 'activation-1',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(async () => client),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn(), getWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', taskService);
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orchestrator/tasks/22222222-2222-4222-8222-222222222222/escalate-to-human',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'escalate-1',
        reason: 'Needs product approval',
        context: {
          summary: 'Plan is blocked on a pricing decision.',
          artifact_id: 'artifact-1',
        },
        recommendation: 'Approve the enterprise pricing change.',
        blocking_task_id: '11111111-1111-1111-1111-111111111111',
        urgency: 'critical',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(taskService.escalateTask).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      '22222222-2222-4222-8222-222222222222',
      {
        reason: 'Needs product approval',
        context: {
          summary: 'Plan is blocked on a pricing decision.',
          artifact_id: 'artifact-1',
        },
        recommendation: 'Approve the enterprise pricing change.',
        blocking_task_id: '11111111-1111-1111-1111-111111111111',
        urgency: 'critical',
        escalation_target: 'human',
      },
      client,
    );
    expect(response.json().data).toEqual(escalatedTask);
  });

  it('reads the scoped workflow budget for an orchestrator task', async () => {
    const workflowService = {
      getWorkflowBudget: vi.fn().mockResolvedValue({
        tokens_used: 1200,
        tokens_limit: 5000,
        cost_usd: 1.5,
      }),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-orch-budget']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-orch-budget',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: null,
              stage_name: 'implementation',
              activation_id: 'activation-1',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', workflowService);
    app.decorate('taskService', { createTask: vi.fn() });
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/orchestrator/tasks/task-orch-budget/workflow/budget',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(workflowService.getWorkflowBudget).toHaveBeenCalledWith('tenant-1', 'workflow-1');
    expect(response.json().data).toEqual(
      expect.objectContaining({ tokens_used: 1200, cost_usd: 1.5 }),
    );
  });

  it('sends live managed-task messages through the worker connection hub', async () => {
    let committedMutation = false;
    const managedTask = {
      id: 'task-managed-1',
      workflow_id: 'workflow-1',
      is_orchestrator_task: false,
      state: 'in_progress',
      assigned_worker_id: 'worker-1',
      stage_name: 'implementation',
    };
    const taskService = {
      createTask: vi.fn(),
      getTask: vi.fn(),
    };
    const sendToWorker = vi.fn(() => {
      expect(committedMutation).toBe(true);
      return true;
    });
    const emit = vi.fn(async () => undefined);
    const messageRow = {
      id: 'message-1',
      tenant_id: 'tenant-1',
      workflow_id: 'workflow-1',
      task_id: 'task-managed-1',
      orchestrator_task_id: 'task-orch-message',
      activation_id: 'activation-1',
      stage_name: 'implementation',
      worker_id: 'worker-1',
      request_id: 'msg-1',
      urgency: 'important',
      message: 'Focus on the failing API regression first.',
      delivery_state: 'pending_delivery',
      delivery_attempt_count: 0,
      last_delivery_attempt_at: null,
      delivered_at: null,
      created_at: new Date('2026-03-12T00:00:00.000Z'),
    };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN') {
          return { rowCount: 0, rows: [] };
        }
        if (sql === 'COMMIT') {
          committedMutation = true;
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'send_task_message', 'msg-1']);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return {
            rowCount: 1,
            rows: [{
              response: {
                success: true,
                delivered: false,
                task_id: 'task-managed-1',
                message_id: 'msg-1',
                urgency: 'important',
                delivery_state: 'pending_delivery',
              },
            }],
          };
        }
        if (sql.includes('SELECT id, workflow_id, is_orchestrator_task, state, assigned_worker_id, stage_name')) {
          expect(params).toEqual(['tenant-1', 'task-managed-1']);
          return {
            rowCount: 1,
            rows: [managedTask],
          };
        }
        if (sql.includes('INSERT INTO orchestrator_task_messages')) {
          return {
            rowCount: 1,
            rows: [messageRow],
          };
        }
        if (sql.includes('FROM orchestrator_task_messages') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [messageRow],
          };
        }
        if (sql.includes("SET delivery_state = 'delivery_in_progress'")) {
          return {
            rowCount: 1,
            rows: [
              {
                ...messageRow,
                delivery_state: 'delivery_in_progress',
                delivery_attempt_count: 1,
                last_delivery_attempt_at: new Date('2026-03-12T00:00:01.000Z'),
              },
            ],
          };
        }
        if (sql.includes('UPDATE orchestrator_task_messages') && sql.includes('delivered_at = CASE WHEN $2 = \'delivered\'')) {
          return {
            rowCount: 1,
            rows: [
              {
                ...messageRow,
                delivery_state: 'delivered',
                delivery_attempt_count: 1,
                last_delivery_attempt_at: new Date('2026-03-12T00:00:01.000Z'),
                delivered_at: new Date('2026-03-12T00:00:02.000Z'),
              },
            ],
          };
        }
        if (sql.includes('UPDATE workflow_tool_results')) {
          return {
            rowCount: 1,
            rows: [{
              response: {
                success: true,
                delivered: true,
                task_id: 'task-managed-1',
                message_id: 'msg-1',
                urgency: 'important',
                issued_at: '2026-03-12T00:00:00.000Z',
                delivery_state: 'delivered',
              },
            }],
          };
        }
        throw new Error(`unexpected client query: ${sql} ${JSON.stringify(params)}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM runtime_defaults')) {
          expect(params).toEqual(['tenant-1', 'platform.worker_dispatch_ack_timeout_ms']);
          return {
            rowCount: 1,
            rows: [{ config_value: '15000' }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-orch-message']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-orch-message',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: null,
              stage_name: 'implementation',
              activation_id: 'activation-1',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('UPDATE workflow_tool_results')) {
          return {
            rowCount: 1,
            rows: [{
              response: {
                success: true,
                delivered: true,
                task_id: 'task-managed-1',
                message_id: 'msg-1',
                urgency: 'important',
                issued_at: '2026-03-12T00:00:00.000Z',
                delivery_state: 'delivered',
              },
            }],
          };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(async () => client),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit });
    app.decorate('workflowService', { getWorkflowBudget: vi.fn() });
    app.decorate('workerConnectionHub', { sendToWorker });
    app.decorate('taskService', taskService);
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orch-message/tasks/task-managed-1/message',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'msg-1',
        message: 'Focus on the failing API regression first.',
        urgency: 'important',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(taskService.getTask).not.toHaveBeenCalled();
    expect(sendToWorker).toHaveBeenCalledWith(
      'worker-1',
      expect.objectContaining({
        type: 'task.message',
        task_id: 'task-managed-1',
        message_id: 'msg-1',
        urgency: 'important',
      }),
    );
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.message_sent',
        entityId: 'task-managed-1',
      }),
      client,
    );
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.message_delivered',
        entityId: 'task-managed-1',
      }),
      client,
    );
    expect(response.json().data).toEqual(
      expect.objectContaining({
        success: true,
        delivered: true,
        message_id: 'msg-1',
        delivery_state: 'delivered',
      }),
    );
  });

  it('delivers a stored pending managed-task message on replay without reinserting it', async () => {
    const managedTask = {
      id: 'task-managed-1',
      workflow_id: 'workflow-1',
      is_orchestrator_task: false,
      state: 'in_progress',
      assigned_worker_id: 'worker-1',
      stage_name: 'implementation',
    };
    const taskService = {
      createTask: vi.fn(),
      getTask: vi.fn(),
    };
    const sendToWorker = vi.fn().mockReturnValue(true);
    const emit = vi.fn(async () => undefined);
    let messageRow: {
      id: string;
      tenant_id: string;
      workflow_id: string;
      task_id: string;
      orchestrator_task_id: string;
      activation_id: string;
      stage_name: string;
      worker_id: string;
      request_id: string;
      urgency: string;
      message: string;
      delivery_state: string;
      delivery_attempt_count: number;
      last_delivery_attempt_at: Date | null;
      delivered_at: Date | null;
      created_at: Date;
    } = {
      id: 'message-1',
      tenant_id: 'tenant-1',
      workflow_id: 'workflow-1',
      task_id: 'task-managed-1',
      orchestrator_task_id: 'task-orch-message',
      activation_id: 'activation-1',
      stage_name: 'implementation',
      worker_id: 'worker-1',
      request_id: 'msg-1',
      urgency: 'important',
      message: 'Focus on the failing API regression first.',
      delivery_state: 'pending_delivery',
      delivery_attempt_count: 0,
      last_delivery_attempt_at: null,
      delivered_at: null,
      created_at: new Date('2026-03-12T00:00:00.000Z'),
    };
    let toolResult: Record<string, unknown> = {
      success: true,
      delivered: false,
      task_id: 'task-managed-1',
      message_id: 'msg-1',
      urgency: 'important',
      issued_at: '2026-03-12T00:00:00.000Z',
      delivery_state: 'pending_delivery',
    };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          return { rowCount: 1, rows: [{ response: toolResult }] };
        }
        if (sql.includes('INSERT INTO orchestrator_task_messages')) {
          throw new Error('replay should not insert a second task message row');
        }
        if (sql.includes('SELECT id, workflow_id, is_orchestrator_task, state, assigned_worker_id, stage_name')) {
          expect(params).toEqual(['tenant-1', 'task-managed-1']);
          return {
            rowCount: 1,
            rows: [managedTask],
          };
        }
        if (sql.includes('FROM orchestrator_task_messages') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [messageRow],
          };
        }
        if (sql.includes("SET delivery_state = 'delivery_in_progress'")) {
          messageRow = {
            ...messageRow,
            delivery_state: 'delivery_in_progress',
            delivery_attempt_count: 1,
            last_delivery_attempt_at: new Date('2026-03-12T00:00:01.000Z'),
          };
          return { rowCount: 1, rows: [messageRow] };
        }
        if (sql.includes('UPDATE orchestrator_task_messages') && sql.includes('delivered_at = CASE WHEN $2 = \'delivered\'')) {
          messageRow = {
            ...messageRow,
            delivery_state: 'delivered',
            delivery_attempt_count: 1,
            last_delivery_attempt_at: new Date('2026-03-12T00:00:01.000Z'),
            delivered_at: new Date('2026-03-12T00:00:02.000Z'),
          };
          return { rowCount: 1, rows: [messageRow] };
        }
        throw new Error(`unexpected client query: ${sql} ${JSON.stringify(params)}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM runtime_defaults')) {
          expect(params).toEqual(['tenant-1', 'platform.worker_dispatch_ack_timeout_ms']);
          return {
            rowCount: 1,
            rows: [{ config_value: '15000' }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-orch-message']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-orch-message',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: null,
              stage_name: 'implementation',
              activation_id: 'activation-1',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('UPDATE workflow_tool_results')) {
          toolResult = params?.[4] as Record<string, unknown>;
          return { rowCount: 1, rows: [{ response: toolResult }] };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(async () => client),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit });
    app.decorate('workflowService', { getWorkflowBudget: vi.fn() });
    app.decorate('workerConnectionHub', { sendToWorker });
    app.decorate('taskService', taskService);
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orch-message/tasks/task-managed-1/message',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'msg-1',
        message: 'Focus on the failing API regression first.',
        urgency: 'important',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(sendToWorker).toHaveBeenCalledTimes(1);
    expect(emit).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.message_sent',
      }),
      client,
    );
    expect(response.json().data).toEqual(
      expect.objectContaining({
        success: true,
        delivered: true,
        message_id: 'msg-1',
        delivery_state: 'delivered',
      }),
    );
  });

  it('recovers a stale delivery_in_progress managed-task message on replay', async () => {
    const managedTask = {
      id: 'task-managed-1',
      workflow_id: 'workflow-1',
      is_orchestrator_task: false,
      state: 'in_progress',
      assigned_worker_id: 'worker-1',
      stage_name: 'implementation',
    };
    const sendToWorker = vi.fn().mockReturnValue(true);
    const emit = vi.fn(async () => undefined);
    let messageRow: {
      id: string;
      tenant_id: string;
      workflow_id: string;
      task_id: string;
      orchestrator_task_id: string;
      activation_id: string;
      stage_name: string;
      worker_id: string;
      request_id: string;
      urgency: string;
      message: string;
      delivery_state: string;
      delivery_attempt_count: number;
      last_delivery_attempt_at: Date | null;
      delivered_at: Date | null;
      created_at: Date;
    } = {
      id: 'message-1',
      tenant_id: 'tenant-1',
      workflow_id: 'workflow-1',
      task_id: 'task-managed-1',
      orchestrator_task_id: 'task-orch-message',
      activation_id: 'activation-1',
      stage_name: 'implementation',
      worker_id: 'worker-1',
      request_id: 'msg-1',
      urgency: 'important',
      message: 'Focus on the failing API regression first.',
      delivery_state: 'delivery_in_progress',
      delivery_attempt_count: 1,
      last_delivery_attempt_at: new Date('2026-03-12T00:00:00.000Z'),
      delivered_at: null,
      created_at: new Date('2026-03-12T00:00:00.000Z'),
    };
    let toolResult: Record<string, unknown> = {
      success: true,
      delivered: false,
      task_id: 'task-managed-1',
      message_id: 'msg-1',
      urgency: 'important',
      issued_at: '2026-03-12T00:00:00.000Z',
      delivery_state: 'delivery_in_progress',
    };
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-03-12T00:00:20.000Z').getTime());
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          return { rowCount: 1, rows: [{ response: toolResult }] };
        }
        if (sql.includes('INSERT INTO orchestrator_task_messages')) {
          throw new Error('replay should not insert a second task message row');
        }
        if (sql.includes('SELECT id, workflow_id, is_orchestrator_task, state, assigned_worker_id, stage_name')) {
          expect(params).toEqual(['tenant-1', 'task-managed-1']);
          return {
            rowCount: 1,
            rows: [managedTask],
          };
        }
        if (sql.includes('FROM orchestrator_task_messages') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [messageRow],
          };
        }
        if (sql.includes("SET delivery_state = 'delivery_in_progress'")) {
          messageRow = {
            ...messageRow,
            delivery_attempt_count: 2,
            last_delivery_attempt_at: new Date('2026-03-12T00:00:20.000Z'),
          };
          return { rowCount: 1, rows: [messageRow] };
        }
        if (sql.includes('UPDATE orchestrator_task_messages') && sql.includes('delivered_at = CASE WHEN $2 = \'delivered\'')) {
          messageRow = {
            ...messageRow,
            delivery_state: 'delivered',
            delivered_at: new Date('2026-03-12T00:00:21.000Z'),
          };
          return { rowCount: 1, rows: [messageRow] };
        }
        throw new Error(`unexpected client query: ${sql} ${JSON.stringify(params)}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM runtime_defaults')) {
          expect(params).toEqual(['tenant-1', 'platform.worker_dispatch_ack_timeout_ms']);
          return {
            rowCount: 1,
            rows: [{ config_value: '15000' }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-orch-message']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-orch-message',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: null,
              stage_name: 'implementation',
              activation_id: 'activation-1',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('UPDATE workflow_tool_results')) {
          toolResult = params?.[4] as Record<string, unknown>;
          return { rowCount: 1, rows: [{ response: toolResult }] };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(async () => client),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', {
      TASK_DEFAULT_TIMEOUT_MINUTES: 30,
    });
    app.decorate('eventService', { emit });
    app.decorate('workflowService', { getWorkflowBudget: vi.fn() });
    app.decorate('workerConnectionHub', { sendToWorker });
    app.decorate('taskService', { createTask: vi.fn(), getTask: vi.fn() });
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orch-message/tasks/task-managed-1/message',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'msg-1',
        message: 'Focus on the failing API regression first.',
        urgency: 'important',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(sendToWorker).toHaveBeenCalledTimes(1);
    expect(messageRow.delivery_attempt_count).toBe(2);
    expect(response.json().data).toEqual(
      expect.objectContaining({
        success: true,
        delivered: true,
        message_id: 'msg-1',
        delivery_state: 'delivered',
      }),
    );
    dateNow.mockRestore();
  });

  it('retries a deferred worker_unavailable managed-task message on replay once the worker is reachable', async () => {
    const managedTask = {
      id: 'task-managed-1',
      workflow_id: 'workflow-1',
      is_orchestrator_task: false,
      state: 'in_progress',
      assigned_worker_id: 'worker-1',
      stage_name: 'implementation',
    };
    const sendToWorker = vi.fn().mockReturnValue(true);
    const emit = vi.fn(async () => undefined);
    let messageRow: {
      id: string;
      tenant_id: string;
      workflow_id: string;
      task_id: string;
      orchestrator_task_id: string;
      activation_id: string;
      stage_name: string;
      worker_id: string;
      request_id: string;
      urgency: string;
      message: string;
      delivery_state: string;
      delivery_attempt_count: number;
      last_delivery_attempt_at: Date | null;
      delivered_at: Date | null;
      created_at: Date;
    } = {
      id: 'message-1',
      tenant_id: 'tenant-1',
      workflow_id: 'workflow-1',
      task_id: 'task-managed-1',
      orchestrator_task_id: 'task-orch-message',
      activation_id: 'activation-1',
      stage_name: 'implementation',
      worker_id: 'worker-1',
      request_id: 'msg-1',
      urgency: 'important',
      message: 'Focus on the failing API regression first.',
      delivery_state: 'worker_unavailable',
      delivery_attempt_count: 1,
      last_delivery_attempt_at: new Date('2026-03-12T00:00:00.000Z'),
      delivered_at: null,
      created_at: new Date('2026-03-12T00:00:00.000Z'),
    };
    let toolResult: Record<string, unknown> = {
      success: true,
      delivered: false,
      task_id: 'task-managed-1',
      message_id: 'msg-1',
      urgency: 'important',
      issued_at: '2026-03-12T00:00:00.000Z',
      delivery_state: 'worker_unavailable',
    };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          return { rowCount: 1, rows: [{ response: toolResult }] };
        }
        if (sql.includes('INSERT INTO orchestrator_task_messages')) {
          throw new Error('replay should not insert a second task message row');
        }
        if (sql.includes('SELECT id, workflow_id, is_orchestrator_task, state, assigned_worker_id, stage_name')) {
          expect(params).toEqual(['tenant-1', 'task-managed-1']);
          return {
            rowCount: 1,
            rows: [managedTask],
          };
        }
        if (sql.includes('FROM orchestrator_task_messages') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [messageRow],
          };
        }
        if (sql.includes("SET delivery_state = 'delivery_in_progress'")) {
          messageRow = {
            ...messageRow,
            delivery_state: 'delivery_in_progress',
            delivery_attempt_count: 2,
            last_delivery_attempt_at: new Date('2026-03-12T00:00:10.000Z'),
          };
          return { rowCount: 1, rows: [messageRow] };
        }
        if (sql.includes('UPDATE orchestrator_task_messages') && sql.includes('delivered_at = CASE WHEN $2 = \'delivered\'')) {
          messageRow = {
            ...messageRow,
            delivery_state: 'delivered',
            delivered_at: new Date('2026-03-12T00:00:11.000Z'),
          };
          return { rowCount: 1, rows: [messageRow] };
        }
        throw new Error(`unexpected client query: ${sql} ${JSON.stringify(params)}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM runtime_defaults')) {
          expect(params).toEqual(['tenant-1', 'platform.worker_dispatch_ack_timeout_ms']);
          return {
            rowCount: 1,
            rows: [{ config_value: '15000' }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('AND id = $2')) {
          expect(params).toEqual(['tenant-1', 'task-orch-message']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-orch-message',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: null,
              stage_name: 'implementation',
              activation_id: 'activation-1',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('UPDATE workflow_tool_results')) {
          toolResult = params?.[4] as Record<string, unknown>;
          return { rowCount: 1, rows: [{ response: toolResult }] };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(async () => client),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit });
    app.decorate('workflowService', { getWorkflowBudget: vi.fn() });
    app.decorate('workerConnectionHub', { sendToWorker });
    app.decorate('taskService', { createTask: vi.fn(), getTask: vi.fn() });
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-orch-message/tasks/task-managed-1/message',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'msg-1',
        message: 'Focus on the failing API regression first.',
        urgency: 'important',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(sendToWorker).toHaveBeenCalledTimes(1);
    expect(messageRow.delivery_state).toBe('delivered');
  expect(response.json().data).toEqual(
      expect.objectContaining({
        success: true,
        delivered: true,
        message_id: 'msg-1',
        delivery_state: 'delivered',
      }),
    );
  });

  it('persists a platform-owned activation finish checkpoint', async () => {
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation_finish', 'finish-1']);
          return { rowCount: 0, rows: [] };
        }
        if (
          sql.includes('FROM tasks')
          && sql.includes('WHERE tenant_id = $1')
          && sql.includes('AND id = $2')
          && !sql.includes('ANY($3')
        ) {
          expect(params).toEqual(['tenant-1', 'task-replay']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-replay',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: 'work-item-1',
              stage_name: 'review',
              activation_id: 'activation-1',
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: true,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM workflow_activations')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-1']);
          return {
            rowCount: 1,
            rows: [{ event_type: 'task.handoff_submitted' }],
          };
        }
        if (sql.includes('FROM workflow_work_items')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'work-item-1']);
          return {
            rowCount: 1,
            rows: [{
              metadata: {
                orchestrator_finish_state: {
                  status_summary: 'Waiting on reviewer reassessment.',
                  next_expected_event: 'task.output_pending_assessment',
                  active_subordinate_tasks: ['task-review-1'],
                },
              },
            }],
          };
        }
        if (sql.includes('jsonb_build_object(\'last_activation_checkpoint\'')) {
          expect(params).toEqual([
            'tenant-1',
            'task-replay',
            {
              activation_id: 'activation-1',
              trigger: 'task.handoff_submitted',
              current_working_state: 'Waiting on reviewer reassessment.',
              next_expected_event: 'task.output_pending_assessment',
              important_ids: ['work-item-1', 'task-review-1'],
            },
          ]);
          return {
            rowCount: 1,
            rows: [{
              metadata: {
                last_activation_checkpoint: {
                  activation_id: 'activation-1',
                  trigger: 'task.handoff_submitted',
                  current_working_state: 'Waiting on reviewer reassessment.',
                  next_expected_event: 'task.output_pending_assessment',
                  important_ids: ['work-item-1', 'task-review-1'],
                },
              },
            }],
          };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return {
            rowCount: 1,
            rows: [{
              response: {
                last_activation_checkpoint: {
                  activation_id: 'activation-1',
                  trigger: 'task.handoff_submitted',
                  current_working_state: 'Waiting on reviewer reassessment.',
                  next_expected_event: 'task.output_pending_assessment',
                  important_ids: ['work-item-1', 'task-review-1'],
                },
              },
            }],
          };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: vi.fn(async () => ({
        query: pool.query,
        release: vi.fn(),
      })),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('workflowService', { createWorkflowWorkItem: vi.fn() });
    app.decorate('taskService', { createTask: vi.fn() });
    app.decorate('workspaceService', {
      patchWorkspaceMemory: vi.fn(),
      removeWorkspaceMemory: vi.fn(),
    });

    await app.register(orchestratorControlRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator/tasks/task-replay/activation-finish',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'finish-1',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.last_activation_checkpoint).toEqual({
      activation_id: 'activation-1',
      trigger: 'task.handoff_submitted',
      current_working_state: 'Waiting on reviewer reassessment.',
      next_expected_event: 'task.output_pending_assessment',
      important_ids: ['work-item-1', 'task-review-1'],
    });
  });
});
