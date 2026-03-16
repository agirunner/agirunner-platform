import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../src/errors/error-handler.js';

vi.mock('../../src/auth/fastify-auth-hook.js', () => ({
  authenticateApiKey: async (request: { auth?: unknown }) => {
    request.auth = {
      id: 'key-1',
      tenantId: 'tenant-1',
      scope: 'admin',
      ownerType: 'user',
      ownerId: 'user-1',
      keyPrefix: 'prefix',
    };
  },
  withScope: () => async () => {},
}));

describe('gate routes', () => {
  let app: ReturnType<typeof fastify> | undefined;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('reads workflow-scoped gates by gate id', async () => {
    const { workflowRoutes } = await import('../../src/api/routes/workflows.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("SELECT wa.payload->>'gate_id' AS gate_id")) {
          return {
            rowCount: 1,
            rows: [{
              gate_id: 'gate-1',
              id: 'activation-row-1',
              workflow_id: 'workflow-1',
              activation_id: 'activation-1',
              request_id: 'gate-1-approve',
              reason: 'stage.gate.approve',
              event_type: 'stage.gate.approve',
              state: 'queued',
              queued_at: new Date('2026-03-11T00:01:00Z'),
              started_at: null,
              consumed_at: null,
              completed_at: null,
              summary: 'Queued follow-up',
              error: null,
              task_id: 'task-orchestrator-1',
              task_title: 'Resume requirements orchestration',
              task_state: 'ready',
              task_started_at: null,
              task_completed_at: null,
            }],
          };
        }
        return {
          rowCount: 1,
          rows: [{
            id: 'gate-1',
            workflow_id: 'workflow-1',
            workflow_name: 'Workflow One',
            stage_id: 'stage-1',
            stage_name: 'requirements',
            stage_goal: 'Define scope',
            status: 'awaiting_approval',
            request_summary: 'Ready for review',
            recommendation: 'approve',
            concerns: [],
            key_artifacts: [],
            requested_by_type: 'orchestrator',
            requested_by_id: 'task-1',
            requested_at: new Date('2026-03-11T00:00:00Z'),
            updated_at: new Date('2026-03-11T00:00:00Z'),
            decided_by_type: null,
            decided_by_id: null,
            decision_feedback: null,
            decided_at: null,
          }],
        };
      }),
    });
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('projectService', { getProject: vi.fn() });
    app.decorate('modelCatalogService', {
      resolveRoleConfig: vi.fn(),
      listProviders: vi.fn(),
      listModels: vi.fn(),
      getProviderForOperations: vi.fn(),
    });
    app.decorate('workflowService', {
      createWorkflow: vi.fn(),
      listWorkflows: vi.fn(),
      getWorkflow: vi.fn(),
      getWorkflowBoard: vi.fn(),
      listWorkflowStages: vi.fn(),
      listWorkflowWorkItems: vi.fn(),
      createWorkflowWorkItem: vi.fn(),
      getWorkflowWorkItem: vi.fn(),
      getWorkflowWorkItemMemory: vi.fn(),
      getWorkflowWorkItemMemoryHistory: vi.fn(),
      updateWorkflowWorkItem: vi.fn(),
      actOnStageGate: vi.fn(),
      getResolvedConfig: vi.fn(),
      cancelWorkflow: vi.fn(),
      pauseWorkflow: vi.fn(),
      resumeWorkflow: vi.fn(),
      deleteWorkflow: vi.fn(),
    });

    await app.register(workflowRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/workflows/workflow-1/gates/gate-1',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual(
      expect.objectContaining({
        id: 'gate-1',
        workflow_id: 'workflow-1',
        stage_id: 'stage-1',
        requested_by_type: 'orchestrator',
        orchestrator_resume_history: [
          expect.objectContaining({
            activation_id: 'activation-1',
            task: expect.objectContaining({
              id: 'task-orchestrator-1',
            }),
          }),
        ],
      }),
    );
  });

  it('reads approval queue gates by gate id', async () => {
    const { approvalQueueRoutes } = await import('../../src/api/routes/approval-queue.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("SELECT wa.payload->>'gate_id' AS gate_id")) {
          return {
            rowCount: 1,
            rows: [{
              gate_id: 'gate-2',
              id: 'activation-row-2',
              workflow_id: 'workflow-2',
              activation_id: 'activation-2',
              request_id: 'gate-2-approve',
              reason: 'stage.gate.approve',
              event_type: 'stage.gate.approve',
              state: 'queued',
              queued_at: new Date('2026-03-11T01:01:00Z'),
              started_at: null,
              consumed_at: null,
              completed_at: null,
              summary: 'Queued follow-up',
              error: null,
              task_id: null,
              task_title: null,
              task_state: null,
              task_started_at: null,
              task_completed_at: null,
            }],
          };
        }
        return {
          rowCount: 1,
          rows: [{
            id: 'gate-2',
            workflow_id: 'workflow-2',
            workflow_name: 'Workflow Two',
            stage_id: 'stage-2',
            stage_name: 'qa',
            stage_goal: 'Validate release',
            status: 'awaiting_approval',
            request_summary: 'Ready for signoff',
            recommendation: 'approve',
            concerns: [],
            key_artifacts: [],
            requested_by_type: 'orchestrator',
            requested_by_id: 'task-2',
            requested_at: new Date('2026-03-11T01:00:00Z'),
            updated_at: new Date('2026-03-11T01:00:00Z'),
            decided_by_type: null,
            decided_by_id: null,
            decision_feedback: null,
            decided_at: null,
          }],
        };
      }),
    });
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });

    await app.register(approvalQueueRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/approvals/gate-2',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual(
      expect.objectContaining({
        id: 'gate-2',
        workflow_id: 'workflow-2',
        stage_name: 'qa',
        requested_by_id: 'task-2',
        orchestrator_resume_history: [
          expect.objectContaining({
            activation_id: 'activation-2',
          }),
        ],
      }),
    );
  });

  it('redacts secret-bearing gate response fields on workflow gate reads', async () => {
    const { workflowRoutes } = await import('../../src/api/routes/workflows.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("SELECT wa.payload->>'gate_id' AS gate_id")) {
          return {
            rowCount: 1,
            rows: [{
              gate_id: 'gate-3',
              id: 'activation-row-3',
              workflow_id: 'workflow-3',
              activation_id: 'activation-3',
              request_id: 'gate-3-approve',
              reason: 'stage.gate.approve',
              event_type: 'stage.gate.approve',
              state: 'queued',
              queued_at: new Date('2026-03-11T02:01:00Z'),
              started_at: null,
              consumed_at: null,
              completed_at: null,
              summary: 'Bearer header.payload.signature',
              error: {
                authorization: 'Bearer header.payload.signature',
              },
              task_id: 'task-orchestrator-3',
              task_title: 'sk-live-title-secret',
              task_state: 'ready',
              task_started_at: null,
              task_completed_at: null,
            }],
          };
        }
        return {
          rowCount: 1,
          rows: [{
            id: 'gate-3',
            workflow_id: 'workflow-3',
            workflow_name: 'Workflow Three',
            stage_id: 'stage-3',
            stage_name: 'delivery',
            stage_goal: 'Ship',
            status: 'awaiting_approval',
            request_summary: 'Bearer header.payload.signature',
            recommendation: 'approve',
            concerns: ['sk-live-concern-secret'],
            key_artifacts: [{
              label: 'deploy token',
              note: 'eyJhbGciOiJIUzI1NiJ9.payload.signature',
              link: 'secret:SAFE_LINK',
            }],
            requested_by_type: 'orchestrator',
            requested_by_id: 'task-3',
            requested_at: new Date('2026-03-11T02:00:00Z'),
            updated_at: new Date('2026-03-11T02:00:00Z'),
            decided_by_type: 'user',
            decided_by_id: 'user-3',
            decision_feedback: 'sk-live-feedback-secret',
            decided_at: new Date('2026-03-11T02:05:00Z'),
            decision_history: [{
              action: 'request_changes',
              actor_type: 'user',
              actor_id: 'user-2',
              feedback: 'Bearer history.payload.signature',
              created_at: '2026-03-11T02:03:00Z',
            }],
          }],
        };
      }),
    });
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: vi.fn(async () => undefined) });
    app.decorate('projectService', { getProject: vi.fn() });
    app.decorate('modelCatalogService', {
      resolveRoleConfig: vi.fn(),
      listProviders: vi.fn(),
      listModels: vi.fn(),
      getProviderForOperations: vi.fn(),
    });
    app.decorate('workflowService', {
      createWorkflow: vi.fn(),
      listWorkflows: vi.fn(),
      getWorkflow: vi.fn(),
      getWorkflowBoard: vi.fn(),
      listWorkflowStages: vi.fn(),
      listWorkflowWorkItems: vi.fn(),
      createWorkflowWorkItem: vi.fn(),
      getWorkflowWorkItem: vi.fn(),
      getWorkflowWorkItemMemory: vi.fn(),
      getWorkflowWorkItemMemoryHistory: vi.fn(),
      updateWorkflowWorkItem: vi.fn(),
      actOnStageGate: vi.fn(),
      getResolvedConfig: vi.fn(),
      cancelWorkflow: vi.fn(),
      pauseWorkflow: vi.fn(),
      resumeWorkflow: vi.fn(),
      deleteWorkflow: vi.fn(),
    });

    await app.register(workflowRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/workflows/workflow-3/gates/gate-3',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual(
      expect.objectContaining({
        request_summary: 'redacted://gate-secret',
        decision_feedback: 'redacted://gate-secret',
        human_decision: expect.objectContaining({
          feedback: 'redacted://gate-secret',
        }),
        concerns: ['redacted://gate-secret'],
        key_artifacts: [
          expect.objectContaining({
            note: 'redacted://gate-secret',
            link: 'redacted://gate-secret',
          }),
        ],
        decision_history: [
          expect.objectContaining({
            feedback: 'redacted://gate-secret',
          }),
        ],
        orchestrator_resume: expect.objectContaining({
          summary: 'redacted://gate-secret',
          error: {
            authorization: 'redacted://gate-secret',
          },
          task: expect.objectContaining({
            title: 'redacted://gate-secret',
          }),
        }),
      }),
    );
  });
});
