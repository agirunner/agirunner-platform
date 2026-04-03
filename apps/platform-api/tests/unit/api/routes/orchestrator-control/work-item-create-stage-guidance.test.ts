import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { orchestratorControlRoutes } from '../../../../../src/api/routes/orchestrator-control/routes.js';
import { ValidationError } from '../../../../../src/errors/domain-errors.js';
import { registerErrorHandler } from '../../../../../src/errors/error-handler.js';

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

describe('orchestratorControlRoutes create_work_item stage guidance', () => {
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

  it('returns recoverable guidance when the requested stage name is not authored', async () => {
    const workflowService = {
      createWorkflowWorkItem: vi.fn(async () => {
        throw new ValidationError("Unknown stage 'fix' for this playbook", {
          recovery_hint: 'orchestrator_guided_recovery',
          reason_code: 'unknown_stage_name',
          requested_stage_name: 'fix',
          authored_stage_names: ['reproduce', 'implement', 'review', 'verify'],
        });
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
            'create-wi-unknown-stage',
          ]);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          expect(params?.[5]).toBe('recoverable_not_applied');
          expect(params?.[6]).toBe('unknown_stage_name');
          expect(params?.[4]).toMatchObject({
            mutation_outcome: 'recoverable_not_applied',
            recovery_class: 'unknown_stage_name',
            reason_code: 'unknown_stage_name',
            requested_stage_name: 'fix',
            authored_stage_names: ['reproduce', 'implement', 'review', 'verify'],
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
          expect(params).toEqual(['tenant-1', 'task-unknown-stage']);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-unknown-stage',
              workflow_id: 'workflow-1',
              workspace_id: 'workspace-1',
              work_item_id: '11111111-1111-4111-8111-111111111111',
              stage_name: 'reproduce',
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
      url: '/api/v1/orchestrator/tasks/task-unknown-stage/work-items',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'create-wi-unknown-stage',
        parent_work_item_id: '11111111-1111-4111-8111-111111111111',
        title: 'Fix Audit Export Hang',
        goal: 'Implement the fix for the audit export hang.',
        acceptance_criteria: 'A verified fix is ready for review.',
        stage_name: 'fix',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual(
      expect.objectContaining({
        mutation_outcome: 'recoverable_not_applied',
        recovery_class: 'unknown_stage_name',
        reason_code: 'unknown_stage_name',
        requested_stage_name: 'fix',
        authored_stage_names: ['reproduce', 'implement', 'review', 'verify'],
        suggested_next_actions: expect.arrayContaining([
          expect.objectContaining({ action_code: 'inspect_stage_contract' }),
          expect.objectContaining({ action_code: 'retry_create_work_item_with_authored_stage_name' }),
        ]),
      }),
    );
  });
});
