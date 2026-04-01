import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../../../../src/errors/error-handler.js';
import { ConflictError, NotFoundError, ValidationError } from '../../../../../src/errors/domain-errors.js';
import { ArtifactService } from '../../../../../src/services/artifacts/artifact-service.js';
import { GuidedClosureRecoveryHelpersService } from '../../../../../src/services/guided-closure/recovery-helpers.js';
import { PlaybookWorkflowControlService } from '../../../../../src/services/playbook-workflow-control/playbook-workflow-control-service.js';
import { TaskAgentScopeService } from '../../../../../src/services/task/task-agent-scope-service.js';
import {
  normalizeExplicitAssessmentSubjectTaskLinkage,
  normalizeOrchestratorChildWorkflowLinkage,
  orchestratorControlRoutes,
} from '../../../../../src/api/routes/orchestrator-control/routes.js';
import { NOT_READY_NOOP_RECOVERY_SAFETYNET } from '../../../../../src/api/routes/orchestrator-control/shared.js';

vi.mock('../../../../../src/auth/fastify-auth-hook.js', () => ({
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
      safetynet_behavior_id: NOT_READY_NOOP_RECOVERY_SAFETYNET.id,
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
