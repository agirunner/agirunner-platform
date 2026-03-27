import { describe, expect, it, vi } from 'vitest';

import { WorkflowCreationService } from '../../src/services/workflow-creation-service.js';

describe('WorkflowCreationService', () => {
  it('persists workflow execution context and attempt lineage when provided', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT * FROM playbooks')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'playbook-1',
              version: 1,
              definition: {
                lifecycle: 'planned',
                board: { columns: [{ id: 'planned', label: 'Planned' }] },
                stages: [{ name: 'implementation', goal: 'Build it' }],
                roles: ['developer'],
              },
            }],
          };
        }
        if (sql.includes('INSERT INTO workflows')) {
          expect(params?.[15]).toBe('enhanced');
          expect(params?.[16]).toBe(1);
          expect(params?.[17]).toBe('tenant-1');
          expect(params?.[18]).toEqual({
            launch: { trigger: 'mission_control' },
            redrive: { source_workflow_id: 'workflow-1' },
          });
          expect(params?.[19]).toBe(
            Buffer.byteLength(
              JSON.stringify({
                launch: { trigger: 'mission_control' },
                redrive: { source_workflow_id: 'workflow-1' },
              }),
              'utf8',
            ),
          );
          expect(params?.[20]).toBe('workflow-1');
          expect(params?.[21]).toBe('workflow-1');
          expect(params?.[22]).toBe(2);
          expect(params?.[23]).toBe('redrive');
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-2',
              playbook_id: 'playbook-1',
              lifecycle: 'planned',
              current_stage: 'implementation',
              context: params?.[18],
              live_visibility_mode_override: params?.[15],
              root_workflow_id: params?.[20],
              previous_attempt_workflow_id: params?.[21],
              attempt_number: params?.[22],
              attempt_kind: params?.[23],
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    const service = new WorkflowCreationService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      stateService: {} as never,
      activationService: { enqueueForWorkflow: vi.fn(async () => ({ id: 'activation-1' })) } as never,
      activationDispatchService: { dispatchActivation: vi.fn(async () => null) } as never,
      stageService: { createStages: vi.fn(async () => []) } as never,
      modelCatalogService: { validateModelOverride: vi.fn(async () => undefined) } as never,
    });

    const result = await service.createWorkflow(
      {
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'tenant',
        ownerId: 'tenant-1',
        keyPrefix: 'admin-key',
        id: 'key-1',
      } as never,
      {
        playbook_id: 'playbook-1',
        name: 'Workflow Retry',
        context: {
          launch: { trigger: 'mission_control' },
          redrive: { source_workflow_id: 'workflow-1' },
        },
        attempt: {
          root_workflow_id: 'workflow-1',
          previous_attempt_workflow_id: 'workflow-1',
          attempt_number: 2,
          attempt_kind: 'redrive',
        },
        live_visibility_mode: 'enhanced',
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        id: 'workflow-2',
        context: {
          launch: { trigger: 'mission_control' },
          redrive: { source_workflow_id: 'workflow-1' },
        },
        root_workflow_id: 'workflow-1',
        previous_attempt_workflow_id: 'workflow-1',
        attempt_number: 2,
        attempt_kind: 'redrive',
        live_visibility_mode_override: 'enhanced',
      }),
    );
  });

  it('keeps typed workspace settings out of workflow config layers when creating a workflow', async () => {
    const validateModelOverride = vi.fn(async () => undefined);
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT * FROM playbooks')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'playbook-1',
              version: 3,
              definition: {
                outcome: 'Ship code',
                lifecycle: 'planned',
                board: {
                  columns: [{ id: 'planned', label: 'Planned' }],
                },
                stages: [{ name: 'implementation', goal: 'Build it' }],
                roles: ['developer'],
                config: {
                  runtime: { timeout: 30 },
                },
              },
            }],
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
          expect(params?.[9]).toEqual({
            runtime: { timeout: 45 },
            model_override: {
              model_id: '00000000-0000-0000-0000-000000000022',
              reasoning_config: { effort: 'high' },
            },
          });
          expect(params?.[10]).toEqual({
            playbook: { runtime: { timeout: 30 } },
            workspace: {
              runtime: {
                timeout: 45,
              },
            },
            run: {
              model_override: {
                model_id: '00000000-0000-0000-0000-000000000022',
                reasoning_config: { effort: 'high' },
              },
            },
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
      }),
      release: vi.fn(),
    };

    const service = new WorkflowCreationService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      stateService: {} as never,
      activationService: {
        enqueueForWorkflow: vi.fn(async () => ({ id: 'activation-1' })),
      } as never,
      activationDispatchService: {
        dispatchActivation: vi.fn(async () => null),
      } as never,
      stageService: {
        createStages: vi.fn(async () => []),
      } as never,
      modelCatalogService: {
        validateModelOverride,
      } as never,
    });

    const result = await service.createWorkflow(
      {
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'tenant',
        ownerId: 'tenant-1',
        keyPrefix: 'admin-key',
        id: 'key-1',
      } as never,
      {
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
      },
    );

    expect(result.id).toBe('workflow-1');
    expect(validateModelOverride).toHaveBeenCalledTimes(1);
    expect(validateModelOverride).toHaveBeenCalledWith(
      'tenant-1',
      {
        model_id: '00000000-0000-0000-0000-000000000022',
        reasoning_config: { effort: 'high' },
      },
      'workflow model_override',
    );
  });

  it('omits workflow-global current_stage from continuous workflow reads', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const activationService = {
      enqueueForWorkflow: vi.fn(async () => ({ id: 'activation-1' })),
    };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT * FROM playbooks')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'playbook-1',
              version: 1,
              definition: {
                outcome: 'Ship code',
                lifecycle: 'ongoing',
                board: {
                  columns: [{ id: 'planned', label: 'Planned' }],
                },
                stages: [{ name: 'implementation', goal: 'Build it' }],
                roles: ['developer'],
              },
            }],
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
      }),
      release: vi.fn(),
    };
    const service = new WorkflowCreationService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: eventService as never,
      stateService: {} as never,
      activationService: activationService as never,
      activationDispatchService: {
        dispatchActivation: vi.fn(async () => null),
      } as never,
      stageService: {
        createStages: vi.fn(async () => []),
      } as never,
      modelCatalogService: {
        validateModelOverride: vi.fn(async () => undefined),
      } as never,
    });

    const result = await service.createWorkflow(
      {
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'tenant',
        ownerId: 'tenant-1',
        keyPrefix: 'admin-key',
        id: 'key-1',
      } as never,
      {
        playbook_id: 'playbook-1',
        name: 'Workflow One',
      },
    );

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

  it('uses workspace terminology when the referenced workspace is missing', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT * FROM playbooks')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'playbook-1',
              version: 1,
              definition: {
                outcome: 'Ship code',
                lifecycle: 'planned',
                board: { columns: [{ id: 'planned', label: 'Planned' }] },
                stages: [{ name: 'implementation', goal: 'Build it' }],
                roles: ['developer'],
              },
            }],
          };
        }
        if (sql.includes('SELECT settings FROM workspaces')) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    const service = new WorkflowCreationService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      stateService: {} as never,
      activationService: { enqueueForWorkflow: vi.fn(async () => ({ id: 'activation-1' })) } as never,
      activationDispatchService: { dispatchActivation: vi.fn(async () => null) } as never,
      stageService: { createStages: vi.fn(async () => []) } as never,
      modelCatalogService: { validateModelOverride: vi.fn(async () => undefined) } as never,
    });

    await expect(
      service.createWorkflow(
        {
          tenantId: 'tenant-1',
          scope: 'admin',
          ownerType: 'tenant',
          ownerId: 'tenant-1',
          keyPrefix: 'admin-key',
          id: 'key-1',
        } as never,
        {
          playbook_id: 'playbook-1',
          workspace_id: 'workspace-1',
          name: 'Workflow One',
        },
      ),
    ).rejects.toThrow('Workspace not found');
  });

  it('rejects missing required playbook launch inputs', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT * FROM playbooks')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'playbook-1',
              version: 1,
              definition: {
                lifecycle: 'planned',
                board: { columns: [{ id: 'planned', label: 'Planned' }] },
                stages: [{ name: 'delivery', goal: 'Ship the requested outcome.' }],
                roles: ['developer'],
                parameters: [{ slug: 'workflow_goal', title: 'Workflow Goal', required: true }],
              },
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const service = new WorkflowCreationService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      stateService: {} as never,
      activationService: { enqueueForWorkflow: vi.fn(async () => ({ id: 'activation-1' })) } as never,
      activationDispatchService: { dispatchActivation: vi.fn(async () => null) } as never,
      stageService: { createStages: vi.fn(async () => []) } as never,
      modelCatalogService: { validateModelOverride: vi.fn(async () => undefined) } as never,
    });

    await expect(
      service.createWorkflow(
        {
          tenantId: 'tenant-1',
          scope: 'admin',
          ownerType: 'tenant',
          ownerId: 'tenant-1',
          keyPrefix: 'admin-key',
          id: 'key-1',
        } as never,
        {
          playbook_id: 'playbook-1',
          name: 'Workflow One',
        },
      ),
    ).rejects.toThrow("Missing required playbook launch input 'workflow_goal'.");
  });

  it('rejects undeclared or non-string playbook launch inputs', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT * FROM playbooks')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'playbook-1',
              version: 1,
              definition: {
                lifecycle: 'planned',
                board: { columns: [{ id: 'planned', label: 'Planned' }] },
                stages: [{ name: 'delivery', goal: 'Ship the requested outcome.' }],
                roles: ['developer'],
                parameters: [{ slug: 'workflow_goal', title: 'Workflow Goal', required: false }],
              },
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };
    const service = new WorkflowCreationService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      stateService: {} as never,
      activationService: { enqueueForWorkflow: vi.fn(async () => ({ id: 'activation-1' })) } as never,
      activationDispatchService: { dispatchActivation: vi.fn(async () => null) } as never,
      stageService: { createStages: vi.fn(async () => []) } as never,
      modelCatalogService: { validateModelOverride: vi.fn(async () => undefined) } as never,
    });

    await expect(
      service.createWorkflow(
        {
          tenantId: 'tenant-1',
          scope: 'admin',
          ownerType: 'tenant',
          ownerId: 'tenant-1',
          keyPrefix: 'admin-key',
          id: 'key-1',
        } as never,
        {
          playbook_id: 'playbook-1',
          name: 'Workflow One',
          parameters: {
            unexpected_input: 'nope',
          },
        },
      ),
    ).rejects.toThrow("Unknown playbook launch input 'unexpected_input'.");

    await expect(
      service.createWorkflow(
        {
          tenantId: 'tenant-1',
          scope: 'admin',
          ownerType: 'tenant',
          ownerId: 'tenant-1',
          keyPrefix: 'admin-key',
          id: 'key-1',
        } as never,
        {
          playbook_id: 'playbook-1',
          name: 'Workflow One',
          parameters: {
            workflow_goal: 42 as unknown as string,
          },
        },
      ),
    ).rejects.toThrow("Playbook launch input 'workflow_goal' must be a string.");
  });
});
