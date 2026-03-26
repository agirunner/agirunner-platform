import fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../src/errors/error-handler.js';
import { taskPlatformRoutes } from '../../src/api/routes/task-platform.routes.js';
import { WorkflowActivationDispatchService } from '../../src/services/workflow-activation-dispatch-service.js';

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

describe('task platform handoff routes', () => {
  let app: ReturnType<typeof fastify> | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('submits a structured handoff for the active task owner', async () => {
    const dispatchSpy = vi
      .spyOn(WorkflowActivationDispatchService.prototype, 'dispatchActivation')
      .mockResolvedValue('orchestrator-task-1');
    const eventService = { emit: vi.fn(async () => undefined) };
    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('assigned_agent_id')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-1',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: 'work-item-1',
              stage_name: 'implementation',
              activation_id: null,
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: false,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('LIMIT 1')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-1',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              role: 'developer',
              stage_name: 'implementation',
              state: 'in_progress',
              rework_count: 0,
              metadata: { team_name: 'delivery' },
            }],
          };
        }
        if (sql.includes('SELECT COALESCE(MAX(sequence)')) {
          return { rowCount: 1, rows: [{ next_sequence: 0 }] };
        }
        if (sql.includes('FROM task_handoffs') && sql.includes('request_id')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM task_handoffs') && sql.includes('task_rework_count')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO task_handoffs')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'handoff-1',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              task_id: 'task-1',
              request_id: 'req-1',
              role: 'developer',
              team_name: 'delivery',
              stage_name: 'implementation',
              sequence: 0,
              summary: 'Implemented auth flow.',
              completion: 'full',
              changes: [],
              decisions: [],
              remaining_items: [],
              blockers: [],
              focus_areas: ['error handling'],
              known_risks: [],
              successor_context: null,
              role_data: {},
              artifact_ids: [],
              created_at: new Date('2026-03-15T12:00:00Z'),
            }],
          };
        }
        if (sql.startsWith('SELECT playbook_id FROM workflows')) {
          return { rowCount: 1, rows: [{ playbook_id: 'playbook-1' }] };
        }
        if (sql.includes('INSERT INTO workflow_activations')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'task-handoff-submitted:task-1:0:req-1',
              reason: 'task.handoff_submitted',
              event_type: 'task.handoff_submitted',
              payload: { task_id: 'task-1' },
              state: 'queued',
              dispatch_attempt: 0,
              dispatch_token: null,
              queued_at: new Date('2026-03-17T12:00:00Z'),
              started_at: null,
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    } as never);
    app.decorate('workspaceService', {} as never);
    app.decorate('eventService', eventService as never);
    app.decorate('config', {
      ARTIFACT_STORAGE_BACKEND: 'local',
      ARTIFACT_LOCAL_ROOT: '/tmp/artifacts',
      ARTIFACT_ACCESS_URL_TTL_SECONDS: 900,
      ARTIFACT_PREVIEW_MAX_BYTES: 1024,
    } as never);

    await app.register(taskPlatformRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-1/handoff',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'req-1',
        summary: 'Implemented auth flow.',
        completion: 'full',
        focus_areas: ['error handling'],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual(
      expect.objectContaining({
        id: 'handoff-1',
        role: 'developer',
        focus_areas: ['error handling'],
      }),
    );
    expect(dispatchSpy).toHaveBeenCalledWith('tenant-1', 'activation-1', undefined);
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workflow.activation_queued',
        entityType: 'workflow',
        entityId: 'workflow-1',
        data: expect.objectContaining({
          event_type: 'task.handoff_submitted',
          reason: 'task.handoff_submitted',
        }),
      }),
      undefined,
    );
  });

  it('accepts explicit completion_state and decision_state payloads on task handoff submission', async () => {
    vi
      .spyOn(WorkflowActivationDispatchService.prototype, 'dispatchActivation')
      .mockResolvedValue('orchestrator-task-1');
    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM tasks') && sql.includes('assigned_agent_id')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-1',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: 'work-item-1',
              stage_name: 'verification',
              activation_id: null,
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: false,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('LIMIT 1')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-1',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              role: 'policy-reviewer',
              stage_name: 'verification',
              state: 'in_progress',
              rework_count: 0,
              is_orchestrator_task: false,
              input: {
                subject_task_id: 'task-dev-1',
                subject_work_item_id: 'work-item-impl-1',
                subject_revision: 3,
              },
              metadata: { task_kind: 'assessment', team_name: 'delivery' },
            }],
          };
        }
        if (sql.includes('SELECT COALESCE(MAX(sequence)')) {
          return { rowCount: 1, rows: [{ next_sequence: 0 }] };
        }
        if (sql.includes('FROM task_handoffs') && sql.includes('request_id')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM task_handoffs') && sql.includes('task_rework_count')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO task_handoffs')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'handoff-1',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              task_id: 'task-1',
              request_id: 'req-1',
              role: 'policy-reviewer',
              team_name: 'delivery',
              stage_name: 'verification',
              sequence: 0,
              summary: 'Blocked pending legal clarification.',
              completion: 'full',
              completion_state: 'full',
              resolution: 'blocked',
              decision_state: 'blocked',
              changes: [],
              decisions: [],
              remaining_items: [],
              blockers: ['Legal clarification is required before release.'],
              focus_areas: [],
              known_risks: [],
              successor_context: null,
              role_data: {},
              subject_ref: {
                kind: 'task',
                task_id: 'task-dev-1',
                work_item_id: 'work-item-impl-1',
              },
              subject_revision: 3,
              outcome_action_applied: 'block_subject',
              branch_id: null,
              artifact_ids: [],
              created_at: new Date('2026-03-23T12:00:00Z'),
            }],
          };
        }
        if (sql.startsWith('SELECT playbook_id FROM workflows')) {
          return { rowCount: 1, rows: [{ playbook_id: 'playbook-1' }] };
        }
        if (sql.includes('INSERT INTO workflow_activations')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'task-handoff-submitted:task-1:0:req-1',
              reason: 'task.handoff_submitted',
              event_type: 'task.handoff_submitted',
              payload: { task_id: 'task-1' },
              state: 'queued',
              dispatch_attempt: 0,
              dispatch_token: null,
              queued_at: new Date('2026-03-23T12:00:00Z'),
              started_at: null,
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    } as never);
    app.decorate('workspaceService', {} as never);
    app.decorate('eventService', { emit: vi.fn(async () => undefined) } as never);
    app.decorate('config', {
      ARTIFACT_STORAGE_BACKEND: 'local',
      ARTIFACT_LOCAL_ROOT: '/tmp/artifacts',
      ARTIFACT_ACCESS_URL_TTL_SECONDS: 900,
      ARTIFACT_PREVIEW_MAX_BYTES: 1024,
    } as never);

    await app.register(taskPlatformRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-1/handoff',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'req-1',
        summary: 'Blocked pending legal clarification.',
        completion_state: 'full',
        decision_state: 'blocked',
        outcome_action_applied: 'block_subject',
        blockers: ['Legal clarification is required before release.'],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual(
      expect.objectContaining({
        id: 'handoff-1',
        completion_state: 'full',
        decision_state: 'blocked',
        outcome_action_applied: 'block_subject',
      }),
    );
  });

  it('accepts guided closure fields on task handoff submission', async () => {
    vi
      .spyOn(WorkflowActivationDispatchService.prototype, 'dispatchActivation')
      .mockResolvedValue('orchestrator-task-1');
    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM tasks') && sql.includes('assigned_agent_id')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-1',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: 'work-item-1',
              stage_name: 'review',
              activation_id: null,
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: false,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('LIMIT 1')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-1',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              role: 'policy-reviewer',
              stage_name: 'review',
              state: 'in_progress',
              rework_count: 0,
              metadata: { task_kind: 'approval', team_name: 'review' },
            }],
          };
        }
        if (sql.includes('SELECT COALESCE(MAX(sequence)')) {
          return { rowCount: 1, rows: [{ next_sequence: 0 }] };
        }
        if (sql.includes('FROM task_handoffs') && sql.includes('request_id')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM task_handoffs') && sql.includes('task_rework_count')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO task_handoffs')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'handoff-guided-1',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              task_id: 'task-1',
              request_id: 'req-guided-1',
              role: 'policy-reviewer',
              team_name: 'review',
              stage_name: 'review',
              sequence: 0,
              summary: 'Advisory approval note recorded.',
              completion: 'full',
              completion_state: 'full',
              resolution: 'approved',
              decision_state: 'approved',
              changes: [],
              decisions: [],
              remaining_items: [],
              blockers: [],
              focus_areas: [],
              known_risks: [],
              recommended_next_actions: [{ action_code: 'continue_work' }],
              waived_steps: [{ code: 'secondary_review', reason: 'Primary review was sufficient.' }],
              completion_callouts: { completion_notes: 'Approval remained advisory.' },
              successor_context: null,
              role_data: { task_kind: 'approval', closure_effect: 'advisory' },
              artifact_ids: [],
              created_at: new Date('2026-03-25T01:00:00Z'),
            }],
          };
        }
        if (sql.startsWith('SELECT playbook_id FROM workflows')) {
          return { rowCount: 1, rows: [{ playbook_id: 'playbook-1' }] };
        }
        if (sql.includes('INSERT INTO workflow_activations')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-guided-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'task-handoff-submitted:task-1:0:req-guided-1',
              reason: 'task.handoff_submitted',
              event_type: 'task.handoff_submitted',
              payload: { task_id: 'task-1' },
              state: 'queued',
              dispatch_attempt: 0,
              dispatch_token: null,
              queued_at: new Date('2026-03-25T01:00:00Z'),
              started_at: null,
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    } as never);
    app.decorate('workspaceService', {} as never);
    app.decorate('eventService', { emit: vi.fn(async () => undefined) } as never);
    app.decorate('config', {
      ARTIFACT_STORAGE_BACKEND: 'local',
      ARTIFACT_LOCAL_ROOT: '/tmp/artifacts',
      ARTIFACT_ACCESS_URL_TTL_SECONDS: 900,
      ARTIFACT_PREVIEW_MAX_BYTES: 1024,
    } as never);

    await app.register(taskPlatformRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-1/handoff',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'req-guided-1',
        summary: 'Advisory approval note recorded.',
        completion: 'full',
        resolution: 'approved',
        closure_effect: 'advisory',
        recommended_next_actions: [{
          action_code: 'continue_work',
          target_type: 'work_item',
          target_id: 'work-item-1',
          why: 'No blocking approval is required.',
          requires_orchestrator_judgment: false,
        }],
        waived_steps: [{
          code: 'secondary_review',
          reason: 'Primary review was sufficient.',
        }],
        completion_callouts: {
          completion_notes: 'Approval remained advisory.',
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual(expect.objectContaining({
      id: 'handoff-guided-1',
      closure_effect: 'advisory',
      completion_callouts: expect.objectContaining({
        completion_notes: 'Approval remained advisory.',
      }),
    }));
  });

  it('rejects handoff submissions that still use legacy review_focus', async () => {
    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('assigned_agent_id')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-1',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: 'work-item-1',
              stage_name: 'implementation',
              activation_id: null,
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: false,
              state: 'in_progress',
            }],
          };
        }
        throw new Error(`Unexpected SQL: ${sql} ${String(params)}`);
      }),
    } as never);
    app.decorate('workspaceService', {} as never);
    app.decorate('config', {
      ARTIFACT_STORAGE_BACKEND: 'local',
      ARTIFACT_LOCAL_ROOT: '/tmp/artifacts',
      ARTIFACT_ACCESS_URL_TTL_SECONDS: 900,
      ARTIFACT_PREVIEW_MAX_BYTES: 1024,
    } as never);

    await app.register(taskPlatformRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-1/handoff',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'req-1',
        summary: 'Implemented auth flow.',
        completion: 'full',
        review_focus: ['error handling'],
      },
    });

    expect(response.statusCode).toBe(422);
  });

  it('rejects handoff submissions that omit completion', async () => {
    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('assigned_agent_id')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-1',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: 'work-item-1',
              stage_name: 'implementation',
              activation_id: null,
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: false,
              state: 'in_progress',
            }],
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    } as never);
    app.decorate('workspaceService', {} as never);
    app.decorate('config', {
      ARTIFACT_STORAGE_BACKEND: 'local',
      ARTIFACT_LOCAL_ROOT: '/tmp/artifacts',
      ARTIFACT_ACCESS_URL_TTL_SECONDS: 900,
      ARTIFACT_PREVIEW_MAX_BYTES: 1024,
    } as never);

    await app.register(taskPlatformRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-1/handoff',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'req-1',
        summary: 'Implemented auth flow.',
      },
    });

    expect(response.statusCode).toBe(422);
  });

  it('rejects handoff submissions that still use partial completion', async () => {
    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM tasks') && sql.includes('assigned_agent_id')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-1',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: 'work-item-1',
              stage_name: 'review',
              activation_id: null,
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: false,
              state: 'in_progress',
            }],
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    } as never);
    app.decorate('workspaceService', {} as never);
    app.decorate('config', {
      ARTIFACT_STORAGE_BACKEND: 'local',
      ARTIFACT_LOCAL_ROOT: '/tmp/artifacts',
      ARTIFACT_ACCESS_URL_TTL_SECONDS: 900,
      ARTIFACT_PREVIEW_MAX_BYTES: 1024,
    } as never);

    await app.register(taskPlatformRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-1/handoff',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'req-1',
        summary: 'Request changes.',
        completion: 'partial',
      },
    });

    expect(response.statusCode).toBe(422);
  });

  it('rejects resolution on non-review task handoffs', async () => {
    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM tasks') && sql.includes('assigned_agent_id')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-1',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: 'work-item-1',
              stage_name: 'requirements',
              activation_id: null,
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: false,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('LIMIT 1')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-1',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              role: 'product-manager',
              stage_name: 'requirements',
              state: 'in_progress',
              rework_count: 0,
              metadata: { team_name: 'delivery' },
            }],
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    } as never);
    app.decorate('workspaceService', {} as never);
    app.decorate('config', {
      ARTIFACT_STORAGE_BACKEND: 'local',
      ARTIFACT_LOCAL_ROOT: '/tmp/artifacts',
      ARTIFACT_ACCESS_URL_TTL_SECONDS: 900,
      ARTIFACT_PREVIEW_MAX_BYTES: 1024,
    } as never);

    await app.register(taskPlatformRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-1/handoff',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'req-1',
        summary: 'Requirements drafted.',
        completion: 'full',
        resolution: 'approved',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('resolution');
  });

  it('rejects continue as an explicit outcome action on handoff submission', async () => {
    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM tasks') && sql.includes('assigned_agent_id')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-1',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: 'work-item-1',
              stage_name: 'review',
              activation_id: null,
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: false,
              state: 'in_progress',
            }],
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    } as never);
    app.decorate('workspaceService', {} as never);
    app.decorate('config', {
      ARTIFACT_STORAGE_BACKEND: 'local',
      ARTIFACT_LOCAL_ROOT: '/tmp/artifacts',
      ARTIFACT_ACCESS_URL_TTL_SECONDS: 900,
      ARTIFACT_PREVIEW_MAX_BYTES: 1024,
    } as never);

    await app.register(taskPlatformRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-1/handoff',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'req-1',
        summary: 'Assessment completed.',
        completion: 'full',
        resolution: 'approved',
        outcome_action_applied: 'continue',
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.message).toContain('Invalid request body');
  });

  it('rejects handoff submissions that omit request_id', async () => {
    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('assigned_agent_id')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-1',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: 'work-item-1',
              stage_name: 'implementation',
              activation_id: null,
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: false,
              state: 'in_progress',
            }],
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    } as never);
    app.decorate('workspaceService', {} as never);
    app.decorate('config', {
      ARTIFACT_STORAGE_BACKEND: 'local',
      ARTIFACT_LOCAL_ROOT: '/tmp/artifacts',
      ARTIFACT_ACCESS_URL_TTL_SECONDS: 900,
      ARTIFACT_PREVIEW_MAX_BYTES: 1024,
    } as never);

    await app.register(taskPlatformRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-1/handoff',
      headers: { authorization: 'Bearer test' },
      payload: {
        summary: 'Implemented auth flow.',
        completion: 'full',
      },
    });

    expect(response.statusCode).toBe(422);
  });

  it('returns schema error detail for unexpected handoff fields', async () => {
    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM tasks') && sql.includes('assigned_agent_id')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-1',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: 'work-item-1',
              stage_name: 'review',
              activation_id: null,
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: false,
              state: 'in_progress',
            }],
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    } as never);
    app.decorate('workspaceService', {} as never);
    app.decorate('config', {
      ARTIFACT_STORAGE_BACKEND: 'local',
      ARTIFACT_LOCAL_ROOT: '/tmp/artifacts',
      ARTIFACT_ACCESS_URL_TTL_SECONDS: 900,
      ARTIFACT_PREVIEW_MAX_BYTES: 1024,
    } as never);

    await app.register(taskPlatformRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task-1/handoff',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'req-1',
        summary: 'Assessment completed.',
        completion: 'full',
        resolution: 'approved',
        next_expected_actor: 'orchestrator',
        next_expected_action: 'dispatch',
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.message).toContain('Invalid request body');
    expect(response.json().error.message).toContain('Unrecognized key');
  });

  it('returns the predecessor handoff for the active task owner', async () => {
    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('assigned_agent_id')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-2',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: 'work-item-1',
              stage_name: 'review',
              activation_id: null,
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: false,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('LIMIT 1')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-2',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              role: 'reviewer',
              stage_name: 'review',
              state: 'in_progress',
              rework_count: 0,
              metadata: {},
            }],
          };
        }
        if (sql.includes('FROM task_handoffs')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'handoff-1',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              task_id: 'task-1',
              request_id: 'req-1',
              role: 'developer',
              team_name: 'delivery',
              stage_name: 'implementation',
              sequence: 0,
              summary: 'Implemented auth flow.',
              completion: 'full',
              changes: [],
              decisions: [],
              remaining_items: [],
              blockers: [],
              focus_areas: ['error handling'],
              known_risks: [],
              successor_context: null,
              role_data: {},
              artifact_ids: [],
              created_at: new Date('2026-03-15T12:00:00Z'),
            }],
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    } as never);
    app.decorate('workspaceService', {} as never);
    app.decorate('config', {
      ARTIFACT_STORAGE_BACKEND: 'local',
      ARTIFACT_LOCAL_ROOT: '/tmp/artifacts',
      ARTIFACT_ACCESS_URL_TTL_SECONDS: 900,
      ARTIFACT_PREVIEW_MAX_BYTES: 1024,
    } as never);

    await app.register(taskPlatformRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks/task-2/predecessor-handoff',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual(
      expect.objectContaining({
        id: 'handoff-1',
        role: 'developer',
      }),
    );
  });

  it('returns the parent-linked predecessor handoff for a successor work item', async () => {
    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('assigned_agent_id')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-release-1',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: 'work-item-release',
              stage_name: 'release',
              activation_id: null,
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: false,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('LIMIT 1')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-release-1',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-release',
              role: 'product-manager',
              stage_name: 'release',
              state: 'in_progress',
              rework_count: 0,
              metadata: {},
            }],
          };
        }
        if (
          sql.includes('FROM task_handoffs') &&
          sql.includes('AND work_item_id = $3') &&
          Array.isArray(params) &&
          params[2] === 'work-item-release'
        ) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('COUNT(*)::int AS sibling_count')) {
          return {
            rowCount: 1,
            rows: [{ sibling_count: 1 }],
          };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('parent_work_item_id')) {
          return {
            rowCount: 1,
            rows: [{ parent_work_item_id: 'work-item-verification' }],
          };
        }
        if (
          sql.includes('FROM task_handoffs') &&
          sql.includes('AND work_item_id = $3') &&
          Array.isArray(params) &&
          params[2] === 'work-item-verification'
        ) {
          return {
            rowCount: 1,
            rows: [{
              id: 'handoff-qa-1',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-verification',
              task_id: 'task-qa-1',
              request_id: 'req-qa-1',
              role: 'qa',
              team_name: null,
              stage_name: 'verification',
              sequence: 0,
              summary: 'QA validated the branch successfully.',
              completion: 'full',
              changes: [],
              decisions: ['Release can proceed'],
              remaining_items: [],
              blockers: [],
              focus_areas: ['Human release approval'],
              known_risks: [],
              successor_context: 'Use the QA evidence for release approval.',
              role_data: {},
              artifact_ids: [],
              created_at: new Date('2026-03-16T12:00:00Z'),
            }],
          };
        }
        if (sql.includes('FROM task_handoffs') && sql.includes('ORDER BY created_at DESC')) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    } as never);
    app.decorate('workspaceService', {} as never);
    app.decorate('config', {
      ARTIFACT_STORAGE_BACKEND: 'local',
      ARTIFACT_LOCAL_ROOT: '/tmp/artifacts',
      ARTIFACT_ACCESS_URL_TTL_SECONDS: 900,
      ARTIFACT_PREVIEW_MAX_BYTES: 1024,
    } as never);

    await app.register(taskPlatformRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks/task-release-1/predecessor-handoff',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual(
      expect.objectContaining({
        id: 'handoff-qa-1',
        role: 'qa',
        successor_context: 'Use the QA evidence for release approval.',
      }),
    );
  });

  it('returns null when parent fallback is ambiguous across sibling work items', async () => {
    app = fastify();
    registerErrorHandler(app);
    app.decorate('pgPool', {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM tasks') && sql.includes('assigned_agent_id')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-release-2',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: 'work-item-release',
              stage_name: 'release',
              activation_id: null,
              assigned_agent_id: 'agent-1',
              is_orchestrator_task: false,
              state: 'in_progress',
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('LIMIT 1')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-release-2',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-release',
              role: 'product-manager',
              stage_name: 'release',
              state: 'in_progress',
              rework_count: 0,
              metadata: {},
            }],
          };
        }
        if (sql.includes('FROM task_handoffs') && sql.includes('AND work_item_id = $3')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('COUNT(*)::int AS sibling_count')) {
          return {
            rowCount: 1,
            rows: [{ sibling_count: 2 }],
          };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('parent_work_item_id')) {
          return {
            rowCount: 1,
            rows: [{ parent_work_item_id: 'work-item-verification' }],
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    } as never);
    app.decorate('workspaceService', {} as never);
    app.decorate('config', {
      ARTIFACT_STORAGE_BACKEND: 'local',
      ARTIFACT_LOCAL_ROOT: '/tmp/artifacts',
      ARTIFACT_ACCESS_URL_TTL_SECONDS: 900,
      ARTIFACT_PREVIEW_MAX_BYTES: 1024,
    } as never);

    await app.register(taskPlatformRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks/task-release-2/predecessor-handoff',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toBeNull();
  });
});
