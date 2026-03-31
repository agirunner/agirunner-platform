import { describe, expect, it, vi } from 'vitest';

import {
  createClient,
  createPlaybookRow,
  createWorkflowCreationService,
  IDENTITY,
  isTransactionControl,
} from './support.js';

describe('WorkflowCreationService config and lifecycle behavior', () => {
  it('strips workflow model overrides from workflow config layers when creating a workflow', async () => {
    const client = createClient();
    client.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (isTransactionControl(sql)) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('SELECT * FROM playbooks')) {
        return {
          rowCount: 1,
          rows: [createPlaybookRow({
            outcome: 'Ship code',
            lifecycle: 'planned',
            board: { columns: [{ id: 'planned', label: 'Planned' }] },
            stages: [{ name: 'implementation', goal: 'Build it' }],
            roles: ['developer'],
            config: { runtime: { timeout: 30 } },
          })],
        };
      }
      if (sql.includes('SELECT settings FROM workspaces')) {
        return {
          rowCount: 1,
          rows: [{
            settings: {
              default_branch: 'main',
              git_user_name: 'Smoke Bot',
              workspace_brief: 'Ship tested code',
              model_overrides: {
                developer: {
                  provider: 'openai',
                  model: 'gpt-5',
                },
              },
              config: {
                runtime: {
                  timeout: 45,
                },
              },
            },
          }],
        };
      }
      if (sql.includes('INSERT INTO workflows')) {
        expect(params?.[6]).toBeNull();
        expect(params?.[9]).toEqual({ runtime: { timeout: 45 } });
        expect(params?.[10]).toEqual({
          playbook: { runtime: { timeout: 30 } },
          workspace: {
            runtime: {
              timeout: 45,
            },
          },
          run: {},
        });
        expect(params?.[12]).toBe(500000);
        expect(params?.[13]).toBe(125.5);
        expect(params?.[14]).toBe(1440);
        return {
          rowCount: 1,
          rows: [{
            id: 'workflow-1',
            playbook_id: 'playbook-1',
            lifecycle: 'planned',
            current_stage: 'implementation',
          }],
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    const service = createWorkflowCreationService(client);
    const result = await service.createWorkflow(IDENTITY as never, {
      playbook_id: 'playbook-1',
      workspace_id: 'workspace-1',
      name: 'Workflow One',
      config_overrides: {
        model_override: {
          model_id: '00000000-0000-0000-0000-000000000022',
          reasoning_config: { effort: 'high' },
        },
      },
      budget: {
        token_budget: 500000,
        cost_cap_usd: 125.5,
        max_duration_minutes: 1440,
      },
    });

    expect(result.id).toBe('workflow-1');
  });

  it('omits workflow-global current_stage from continuous workflow reads', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const activationService = {
      enqueueForWorkflow: vi.fn(async () => ({ id: 'activation-1' })),
    };
    const client = createClient();
    client.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (isTransactionControl(sql)) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('SELECT * FROM playbooks')) {
        return {
          rowCount: 1,
          rows: [createPlaybookRow({
            outcome: 'Ship code',
            lifecycle: 'ongoing',
            board: { columns: [{ id: 'planned', label: 'Planned' }] },
            stages: [{ name: 'implementation', goal: 'Build it' }],
            roles: ['developer'],
          })],
        };
      }
      if (sql.includes('INSERT INTO workflows')) {
        expect(params?.[6]).toBeNull();
        return {
          rowCount: 1,
          rows: [{
            id: 'workflow-1',
            playbook_id: 'playbook-1',
            current_stage: null,
            lifecycle: 'ongoing',
          }],
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    const service = createWorkflowCreationService(client, {
      eventService: eventService as never,
      activationService: activationService as never,
    });

    const result = await service.createWorkflow(IDENTITY as never, {
      playbook_id: 'playbook-1',
      name: 'Workflow One',
    });

    expect(result).not.toHaveProperty('current_stage');
    expect(eventService.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'stage.started' }),
      client,
    );
    expect(activationService.enqueueForWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ payload: {} }),
      client,
    );
  });
});
