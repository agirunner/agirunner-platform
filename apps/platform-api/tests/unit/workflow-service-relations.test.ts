import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkflowService } from '../../src/services/workflow-service.js';

describe('WorkflowService workflow relations', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hydrates child workflow status visibility on workflow lists', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ total: '1' }] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'wf-1',
              tenant_id: 'tenant-1',
              name: 'Parent workflow',
              state: 'active',
              metadata: {
                parent_workflow_id: null,
                child_workflow_ids: ['wf-child-1', 'wf-child-2'],
                latest_child_workflow_id: 'wf-child-2',
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'wf-child-1',
              name: 'Child A',
              state: 'completed',
              playbook_id: 'pb-1',
              playbook_name: 'SDLC',
              created_at: '2026-03-10T00:00:00.000Z',
              started_at: null,
              completed_at: '2026-03-10T01:00:00.000Z',
            },
            {
              id: 'wf-child-2',
              name: 'Child B',
              state: 'failed',
              playbook_id: 'pb-1',
              playbook_name: 'SDLC',
              created_at: '2026-03-10T00:30:00.000Z',
              started_at: null,
              completed_at: '2026-03-10T01:30:00.000Z',
            },
          ],
        }),
    };
    const service = new WorkflowService(
      pool as never,
      { emit: vi.fn() } as never,
      { TASK_DEFAULT_TIMEOUT_MINUTES: 30, ARTIFACT_STORAGE_BACKEND: 'local', ARTIFACT_LOCAL_ROOT: '/tmp' } as never,
    );

    const result = await service.listWorkflows('tenant-1', { page: 1, per_page: 20 });

    expect(result.data[0].workflow_relations).toEqual({
      parent: null,
      children: [
        expect.objectContaining({ workflow_id: 'wf-child-1', state: 'completed', is_terminal: true }),
        expect.objectContaining({ workflow_id: 'wf-child-2', state: 'failed', is_terminal: true }),
      ],
      latest_child_workflow_id: 'wf-child-2',
      child_status_counts: {
        total: 2,
        active: 0,
        completed: 1,
        failed: 1,
        cancelled: 0,
      },
    });
  });

  it('exposes effective model resolution for a workflow', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ config_value: '00000000-0000-0000-0000-000000000010' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({
          rows: [{
            workspace_id: null,
            resolved_config: {},
            config_layers: {
              run: {
                model_override: {
                  model_id: '00000000-0000-0000-0000-000000000011',
                  reasoning_config: { effort: 'high' },
                },
              },
            },
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{
            id: '00000000-0000-0000-0000-000000000011',
            tenant_id: 'tenant-1',
            provider_id: 'provider-1',
            model_id: 'claude-opus-4-1',
            context_window: 200000,
            max_output_tokens: 8192,
            supports_tool_use: true,
            supports_vision: true,
            input_cost_per_million_usd: '15.00',
            output_cost_per_million_usd: '75.00',
            is_enabled: true,
            endpoint_type: 'chat',
            reasoning_config: { type: 'effort', default: 'medium' },
            created_at: new Date(),
            provider_name: 'anthropic',
            provider_base_url: 'https://api.anthropic.com',
          }],
          rowCount: 1,
        }),
    };
    const service = new WorkflowService(
      pool as never,
      { emit: vi.fn() } as never,
      { TASK_DEFAULT_TIMEOUT_MINUTES: 30, ARTIFACT_STORAGE_BACKEND: 'local', ARTIFACT_LOCAL_ROOT: '/tmp' } as never,
    );

    const result = await service.getEffectiveModel('tenant-1', 'wf-1');

    expect(result).toEqual({
      workflow_id: 'wf-1',
      modelId: '00000000-0000-0000-0000-000000000011',
      reasoningConfig: { effort: 'high' },
      modelSource: 'workflow',
      reasoningSource: 'workflow',
      model: expect.objectContaining({
        id: '00000000-0000-0000-0000-000000000011',
        modelId: 'claude-opus-4-1',
        providerName: 'anthropic',
      }),
    });
  });

  it('redacts secret-bearing resolved config views without preserving secret references', async () => {
    const pool = {
      query: vi.fn(),
    };
    const repoModule = await import('../../src/db/tenant-scoped-repository.js');
    vi.spyOn(repoModule.TenantScopedRepository.prototype, 'findById').mockResolvedValue({
      id: 'wf-1',
      tenant_id: 'tenant-1',
      resolved_config: {
        provider: {
          api_key: 'inline-secret',
          api_key_secret_ref: 'secret:OPENAI_API_KEY',
        },
      },
      config_layers: {
        playbook: {
          provider: {
            api_key: 'playbook-secret',
          },
        },
        run: {
          headers: {
            authorization: 'Bearer runtime-secret',
          },
        },
      },
    });
    const service = new WorkflowService(
      pool as never,
      { emit: vi.fn() } as never,
      { TASK_DEFAULT_TIMEOUT_MINUTES: 30, ARTIFACT_STORAGE_BACKEND: 'local', ARTIFACT_LOCAL_ROOT: '/tmp' } as never,
    );

    const result = await service.getResolvedConfig('tenant-1', 'wf-1', true);

    expect(result).toEqual({
      workflow_id: 'wf-1',
      resolved_config: {
        provider: {
          api_key: {
            value: 'redacted://workflow-config-secret',
            source: 'playbook',
          },
          api_key_secret_ref: {
            value: 'redacted://workflow-config-secret',
            source: 'playbook',
          },
        },
      },
      config_layers: {
        playbook: {
          provider: {
            api_key: 'redacted://workflow-config-secret',
          },
        },
        workspace: {},
        run: {
          headers: {
            authorization: 'redacted://workflow-config-secret',
          },
        },
      },
    });
  });

});
