import { describe, expect, it, vi } from 'vitest';

import { WorkflowCreationService } from '../../src/services/workflow-creation-service.js';

describe('WorkflowCreationService', () => {
  it('persists resolved model override config layers when creating a workflow', async () => {
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
                lifecycle: 'standard',
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
        if (sql.includes('SELECT settings FROM projects')) {
          return {
            rowCount: 1,
            rows: [{
              settings: {
                model_override: {
                  model_id: '00000000-0000-0000-0000-000000000021',
                  reasoning_config: { effort: 'medium' },
                },
              },
            }],
          };
        }
        if (sql.includes('INSERT INTO workflows')) {
          expect(params?.[9]).toEqual({
            runtime: { timeout: 30 },
            model_override: {
              model_id: '00000000-0000-0000-0000-000000000022',
              reasoning_config: { effort: 'high' },
            },
          });
          expect(params?.[10]).toEqual({
            playbook: { runtime: { timeout: 30 } },
            project: {
              model_override: {
                model_id: '00000000-0000-0000-0000-000000000021',
                reasoning_config: { effort: 'medium' },
              },
            },
            run: {
              model_override: {
                model_id: '00000000-0000-0000-0000-000000000022',
                reasoning_config: { effort: 'high' },
              },
            },
          });
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              playbook_id: 'playbook-1',
              lifecycle: 'standard',
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
        project_id: 'project-1',
        name: 'Workflow One',
        config_overrides: {
          model_override: {
            model_id: '00000000-0000-0000-0000-000000000022',
            reasoning_config: { effort: 'high' },
          },
        },
      },
    );

    expect(result.id).toBe('workflow-1');
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
                lifecycle: 'continuous',
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
              lifecycle: 'continuous',
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
});
