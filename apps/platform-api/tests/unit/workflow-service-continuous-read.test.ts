import { describe, expect, it, vi } from 'vitest';

import { WorkflowService } from '../../src/services/workflow-service.js';

const config = {
  TASK_DEFAULT_TIMEOUT_MINUTES: 30,
  ARTIFACT_STORAGE_BACKEND: 'local' as const,
  ARTIFACT_LOCAL_ROOT: '/tmp',
};

describe('WorkflowService continuous workflow reads', () => {
  it('removes workflow-global current_stage on workflow lists and exposes derived active stages', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total: '1' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'wf-1',
            tenant_id: 'tenant-1',
            lifecycle: 'ongoing',
            current_stage: 'legacy-stage',
            playbook_definition: {
              lifecycle: 'ongoing',
              roles: ['triager'],
              board: { columns: [{ id: 'planned', label: 'Planned' }] },
              stages: [
                { name: 'triage', goal: 'Triage inbound work' },
                { name: 'implementation', goal: 'Implement approved work' },
              ],
            },
            work_item_summary: {
              total_work_items: 3,
              open_work_item_count: 2,
              blocked_work_item_count: 1,
              completed_work_item_count: 1,
              active_stage_count: 99,
              awaiting_gate_count: 1,
              active_stage_names: ['implementation', 'triage'],
            },
            metadata: {},
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ workflow_id: 'wf-1', blocked_work_item_count: 1 }],
      });
    const pool = {
      query,
    };

    const service = new WorkflowService(pool as never, { emit: vi.fn() } as never, config as never);
    const result = await service.listWorkflows('tenant-1', { page: 1, per_page: 20 });
    const listSql = String(pool.query.mock.calls[1]?.[0] ?? '');
    const blockedSql = String(pool.query.mock.calls[2]?.[0] ?? '');

    expect(result.data[0]).not.toHaveProperty('current_stage');
    expect(result.data[0]).not.toHaveProperty('template_id');
    expect(result.data[0]).not.toHaveProperty('template_name');
    expect(result.data[0]).not.toHaveProperty('template_version');
    expect(result.data[0]).not.toHaveProperty('current_phase');
    expect(result.data[0]).not.toHaveProperty('workflow_phase');
    expect(result.data[0]).not.toHaveProperty('phases');
    expect(result.data[0]).not.toHaveProperty('phase_summary');
    expect(listSql).not.toContain('SELECT w.*');
    expect(listSql).not.toContain('template_id');
    expect(listSql).not.toContain('current_phase');
    expect(listSql).not.toContain('w.current_stage');
    expect(listSql).toContain("WHEN w.lifecycle = 'ongoing'");
    expect(listSql).toContain("THEN COALESCE(work_item_summary.active_stage_count, 0)");
    expect(listSql).toContain("THEN COALESCE(to_jsonb(work_item_summary.active_stage_names), '[]'::jsonb)");
    expect(blockedSql).toContain("COALESCE(assessment_task.metadata->>'task_kind', '') = 'assessment'");
    expect(blockedSql).not.toContain('assessment_rules');
    expect(result.data[0].active_stages).toEqual(['triage', 'implementation']);
    expect(result.data[0]).not.toHaveProperty('playbook_definition');
    expect(result.data[0].work_item_summary).toEqual({
      total_work_items: 3,
      open_work_item_count: 2,
      blocked_work_item_count: 1,
      completed_work_item_count: 1,
      active_stage_count: 2,
      awaiting_gate_count: 1,
      active_stage_names: ['triage', 'implementation'],
    });
  });

  it('removes workflow-global current_stage on workflow detail reads and derives counts and gate state from work items and stages', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              id: 'wf-1',
              tenant_id: 'tenant-1',
              playbook_id: 'pb-1',
              lifecycle: 'ongoing',
              current_stage: 'legacy-stage',
              metadata: {},
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              definition: {
                board: {
                  columns: [
                    { id: 'queued', label: 'Queued' },
                    { id: 'active', label: 'Active' },
                    { id: 'done', label: 'Done', is_terminal: true },
                  ],
                },
                stages: [
                  { name: 'triage', goal: 'Sort work' },
                  { name: 'implementation', goal: 'Do work' },
                ],
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              definition: {
                board: {
                  columns: [
                    { id: 'queued', label: 'Queued' },
                    { id: 'done', label: 'Done', is_terminal: true },
                  ],
                },
                stages: [
                  { name: 'triage', goal: 'Sort work' },
                  { name: 'review', goal: 'Review work' },
                ],
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              definition: {
                board: { columns: [{ id: 'planned', label: 'Planned' }] },
                stages: [
                  { name: 'triage', goal: 'Triage inbound work' },
                  { name: 'implementation', goal: 'Implement approved work' },
                ],
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              definition: {
                board: {
                  columns: [
                    { id: 'queued', label: 'Queued' },
                    { id: 'active', label: 'Active' },
                    { id: 'done', label: 'Done', is_terminal: true },
                  ],
                },
                stages: [
                  { name: 'triage', goal: 'Sort work' },
                  { name: 'implementation', goal: 'Do work' },
                ],
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              definition: {
                board: {
                  columns: [
                    { id: 'queued', label: 'Queued' },
                    { id: 'active', label: 'Active' },
                    { id: 'done', label: 'Done', is_terminal: true },
                  ],
                },
                stages: [
                  { name: 'triage', goal: 'Sort work' },
                  { name: 'implementation', goal: 'Do work' },
                ],
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              definition: {
                board: {
                  columns: [
                    { id: 'queued', label: 'Queued' },
                    { id: 'active', label: 'Active' },
                    { id: 'done', label: 'Done', is_terminal: true },
                  ],
                },
                stages: [
                  { name: 'triage', goal: 'Sort work' },
                  { name: 'implementation', goal: 'Do work' },
                ],
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              definition: {
                board: {
                  columns: [
                    { id: 'queued', label: 'Queued' },
                    { id: 'active', label: 'Active' },
                    { id: 'done', label: 'Done', is_terminal: true },
                  ],
                },
                stages: [
                  { name: 'triage', goal: 'Sort work' },
                  { name: 'implementation', goal: 'Do work' },
                ],
              },
            },
          ],
        }),
    };

    const service = new WorkflowService(pool as never, { emit: vi.fn() } as never, config as never);
    (service as unknown as { workItemService: { listWorkflowWorkItems: ReturnType<typeof vi.fn> } }).workItemService = {
      listWorkflowWorkItems: vi.fn().mockResolvedValue([
        { id: 'wi-1', stage_name: 'triage', completed_at: null },
        { id: 'wi-2', stage_name: 'implementation', completed_at: null },
        { id: 'wi-3', stage_name: 'triage', completed_at: '2026-03-11T00:00:00.000Z' },
      ]),
    };
    (service as unknown as { activationService: { listWorkflowActivations: ReturnType<typeof vi.fn> } }).activationService = {
      listWorkflowActivations: vi.fn().mockResolvedValue([]),
    };
    (service as unknown as { stageService: { listStages: ReturnType<typeof vi.fn> } }).stageService = {
      listStages: vi.fn().mockResolvedValue([
        { name: 'triage', gate_status: 'awaiting_approval' },
        { name: 'implementation', gate_status: 'not_requested' },
      ]),
    };

    const workflow = await service.getWorkflow('tenant-1', 'wf-1');
    const detailSql = String(pool.query.mock.calls[0]?.[0] ?? '');

    expect(workflow).not.toHaveProperty('current_stage');
    expect(workflow).not.toHaveProperty('template_id');
    expect(workflow).not.toHaveProperty('template_name');
    expect(workflow).not.toHaveProperty('template_version');
    expect(workflow).not.toHaveProperty('current_phase');
    expect(workflow).not.toHaveProperty('workflow_phase');
    expect(workflow).not.toHaveProperty('phases');
    expect(workflow).not.toHaveProperty('phase_summary');
    expect(detailSql).not.toContain('SELECT * FROM workflows');
    expect(detailSql).not.toContain('current_stage');
    expect(detailSql).not.toContain('template_id');
    expect(detailSql).not.toContain('current_phase');
    expect(workflow.active_stages).toEqual(['triage', 'implementation']);
    expect(workflow.work_item_summary).toEqual({
      total_work_items: 3,
      open_work_item_count: 2,
      blocked_work_item_count: 0,
      completed_work_item_count: 1,
      active_stage_count: 2,
      awaiting_gate_count: 1,
      active_stage_names: ['triage', 'implementation'],
    });
  });

  it('does not fall back to stored workflow current_stage on standard workflow detail reads', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              id: 'wf-standard',
              tenant_id: 'tenant-1',
              playbook_id: 'pb-1',
              lifecycle: 'planned',
              current_stage: 'implementation',
              metadata: {},
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              definition: {
                board: { columns: [{ id: 'queued', label: 'Queued' }] },
                stages: [{ name: 'implementation', goal: 'Implement work' }],
              },
            },
          ],
        }),
    };

    const service = new WorkflowService(pool as never, { emit: vi.fn() } as never, config as never);
    (service as unknown as { workItemService: { listWorkflowWorkItems: ReturnType<typeof vi.fn> } }).workItemService = {
      listWorkflowWorkItems: vi.fn().mockResolvedValue([]),
    };
    (service as unknown as { activationService: { listWorkflowActivations: ReturnType<typeof vi.fn> } }).activationService = {
      listWorkflowActivations: vi.fn().mockResolvedValue([]),
    };
    (service as unknown as { stageService: { listStages: ReturnType<typeof vi.fn> } }).stageService = {
      listStages: vi.fn().mockResolvedValue([]),
    };

    const workflow = await service.getWorkflow('tenant-1', 'wf-standard');
    const detailSql = String(pool.query.mock.calls[0]?.[0] ?? '');

    expect(detailSql).not.toContain('current_stage');
    expect(workflow.current_stage).toBeNull();
  });

  it('derives standard workflow current_stage from the stage projection instead of stale stored state', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              id: 'wf-standard',
              tenant_id: 'tenant-1',
              playbook_id: 'pb-1',
              lifecycle: 'planned',
              current_stage: 'design',
              metadata: {},
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              definition: {
                board: { columns: [{ id: 'planned', label: 'Planned' }] },
                stages: [
                  { name: 'design', goal: 'Design work' },
                  { name: 'implementation', goal: 'Implement work' },
                ],
              },
            },
          ],
        }),
    };

    const service = new WorkflowService(pool as never, { emit: vi.fn() } as never, config as never);
    (service as unknown as { workItemService: { listWorkflowWorkItems: ReturnType<typeof vi.fn> } }).workItemService = {
      listWorkflowWorkItems: vi.fn().mockResolvedValue([]),
    };
    (service as unknown as { activationService: { listWorkflowActivations: ReturnType<typeof vi.fn> } }).activationService = {
      listWorkflowActivations: vi.fn().mockResolvedValue([]),
    };
    (service as unknown as { stageService: { listStages: ReturnType<typeof vi.fn> } }).stageService = {
      listStages: vi.fn().mockResolvedValue([
        {
          id: 'stage-1',
          name: 'design',
          position: 0,
          goal: 'Design work',
          guidance: null,
          human_gate: false,
          status: 'completed',
          is_active: false,
          gate_status: 'not_requested',
          iteration_count: 0,
          summary: null,
          started_at: '2026-03-11T00:00:00.000Z',
          completed_at: '2026-03-11T00:30:00.000Z',
          open_work_item_count: 0,
          total_work_item_count: 1,
        },
        {
          id: 'stage-2',
          name: 'implementation',
          position: 1,
          goal: 'Implement work',
          guidance: null,
          human_gate: false,
          status: 'active',
          is_active: true,
          gate_status: 'not_requested',
          iteration_count: 0,
          summary: null,
          started_at: '2026-03-11T01:00:00.000Z',
          completed_at: null,
          open_work_item_count: 1,
          total_work_item_count: 1,
        },
      ]),
    };

    const workflow = await service.getWorkflow('tenant-1', 'wf-standard');

    expect(workflow.current_stage).toBe('implementation');
  });

  it('redacts secret-bearing workflow and embedded task payloads on workflow detail reads', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              id: 'wf-1',
              tenant_id: 'tenant-1',
              playbook_id: 'pb-1',
              lifecycle: 'planned',
              current_stage: 'implementation',
              metadata: {
                child_workflow_ids: ['wf-child-1'],
                api_key: 'plain-secret',
              },
              context: {
                oauth_token: 'plain-token',
              },
              parameters: {
                private_key: 'plain-private-key',
              },
              resolved_config: {
                provider: {
                  api_key: 'plain-config-secret',
                  api_key_secret_ref: 'secret:OPENAI_API_KEY',
                },
              },
              config_layers: {
                run: {
                  headers: {
                    authorization: 'Bearer top-secret-token',
                  },
                },
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'task-1',
              tenant_id: 'tenant-1',
              workflow_id: 'wf-1',
              input: { api_key: 'task-input-secret', api_key_secret_ref: 'secret:TASK_INPUT_KEY' },
              context: { password: 'task-context-secret', token_ref: 'secret:TASK_CONTEXT_TOKEN' },
              output: { token: 'task-output-secret', result_ref: 'secret:TASK_OUTPUT_TOKEN' },
              error: { authorization: 'Bearer failure-secret', secret_ref: 'secret:TASK_ERROR_SECRET' },
              role_config: {
                webhook_url: 'https://hooks.slack.com/services/plain-secret',
                api_key_secret_ref: 'secret:TASK_ROLE_SECRET',
              },
              environment: { ACCESS_TOKEN: 'task-env-secret', TOKEN_REF: 'secret:TASK_ENV_SECRET' },
              resource_bindings: [{ credentials: { token: 'binding-secret', token_ref: 'secret:TASK_BINDING_SECRET' } }],
              metrics: { summary: 'kept' },
              git_info: { private_key: 'task-git-secret', ssh_key_ref: 'secret:TASK_GIT_SECRET' },
              metadata: { refresh_token: 'task-meta-secret', secret_ref: 'secret:TASK_META_SECRET' },
            },
          ],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              definition: {
                board: { columns: [{ id: 'queued', label: 'Queued' }] },
                stages: [{ name: 'implementation', goal: 'Implement work' }],
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [],
        }),
    };

    const service = new WorkflowService(pool as never, { emit: vi.fn() } as never, config as never);
    (service as unknown as { workItemService: { listWorkflowWorkItems: ReturnType<typeof vi.fn> } }).workItemService = {
      listWorkflowWorkItems: vi.fn().mockResolvedValue([]),
    };
    (service as unknown as { activationService: { listWorkflowActivations: ReturnType<typeof vi.fn> } }).activationService = {
      listWorkflowActivations: vi.fn().mockResolvedValue([]),
    };
    (service as unknown as { stageService: { listStages: ReturnType<typeof vi.fn> } }).stageService = {
      listStages: vi.fn().mockResolvedValue([]),
    };

    const workflow = await service.getWorkflow('tenant-1', 'wf-1');

    expect(workflow.metadata).toEqual({
      child_workflow_ids: ['wf-child-1'],
      api_key: 'redacted://workflow-metadata-secret',
    });
    expect(workflow.context).toEqual({
      oauth_token: 'redacted://workflow-context-secret',
    });
    expect(workflow.parameters).toEqual({
      private_key: 'redacted://workflow-parameters-secret',
    });
    expect(workflow.resolved_config).toEqual({
      provider: {
        api_key: 'redacted://workflow-config-secret',
        api_key_secret_ref: 'redacted://workflow-config-secret',
      },
    });
    expect(workflow.config_layers).toEqual({
      run: {
        headers: {
          authorization: 'redacted://workflow-config-secret',
        },
      },
    });
    expect(workflow.tasks).toEqual([
      expect.objectContaining({
        input: {
          api_key: 'redacted://task-secret',
          api_key_secret_ref: 'redacted://task-secret',
        },
        context: {
          password: 'redacted://task-secret',
          token_ref: 'redacted://task-secret',
        },
        output: {
          token: 'redacted://task-secret',
          result_ref: 'redacted://task-secret',
        },
        error: {
          authorization: 'redacted://task-secret',
          secret_ref: 'redacted://task-secret',
        },
        role_config: {
          webhook_url: 'redacted://task-secret',
          api_key_secret_ref: 'redacted://task-secret',
        },
        environment: {
          ACCESS_TOKEN: 'redacted://task-secret',
          TOKEN_REF: 'redacted://task-secret',
        },
        resource_bindings: [{
          credentials: {
            token: 'redacted://task-secret',
            token_ref: 'redacted://task-secret',
          },
        }],
        metrics: { summary: 'kept' },
        git_info: {
          private_key: 'redacted://task-secret',
          ssh_key_ref: 'redacted://task-secret',
        },
        metadata: {
          refresh_token: 'redacted://task-secret',
          secret_ref: 'redacted://task-secret',
        },
      }),
    ]);
  });

  it('normalizes continuous board summaries from workflow stage state instead of playbook order alone', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              id: 'wf-1',
              tenant_id: 'tenant-1',
              playbook_id: 'pb-1',
              lifecycle: 'ongoing',
              current_stage: 'legacy-stage',
              metadata: {},
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              definition: {
                board: {
                  columns: [
                    { id: 'queued', label: 'Queued' },
                    { id: 'done', label: 'Done', is_terminal: true },
                  ],
                },
                stages: [
                  { name: 'triage', goal: 'Sort work' },
                  { name: 'review', goal: 'Review work' },
                ],
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              definition: {
                board: {
                  columns: [
                    { id: 'queued', label: 'Queued' },
                    { id: 'done', label: 'Done', is_terminal: true },
                  ],
                },
                stages: [
                  { name: 'triage', goal: 'Sort work' },
                  { name: 'review', goal: 'Review work' },
                ],
              },
            },
          ],
        }),
    };

    const service = new WorkflowService(pool as never, { emit: vi.fn() } as never, config as never);
    (service as unknown as { workItemService: { listWorkflowWorkItems: ReturnType<typeof vi.fn> } }).workItemService = {
      listWorkflowWorkItems: vi.fn().mockResolvedValue([
        {
          id: 'wi-parent',
          stage_name: 'triage',
          column_id: 'queued',
          completed_at: null,
          children_count: 1,
          is_milestone: true,
        },
        {
          id: 'wi-2',
          stage_name: 'review',
          column_id: 'done',
          completed_at: '2026-03-11T00:00:00.000Z',
          parent_work_item_id: 'wi-parent',
        },
      ]),
    };
    (service as unknown as { activationService: { listWorkflowActivations: ReturnType<typeof vi.fn> } }).activationService = {
      listWorkflowActivations: vi.fn().mockResolvedValue([]),
    };
    (service as unknown as { stageService: { listStages: ReturnType<typeof vi.fn> } }).stageService = {
      listStages: vi.fn().mockResolvedValue([
        { name: 'triage', goal: 'Sort work', status: 'active', gate_status: 'not_requested' },
        { name: 'review', goal: 'Review work', status: 'awaiting_gate', gate_status: 'awaiting_approval' },
      ]),
    };

    const board = await service.getWorkflowBoard('tenant-1', 'wf-1');

    expect(board.active_stages).toEqual(['triage']);
    expect(board.awaiting_gate_count).toBe(1);
    expect(board.work_items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'wi-parent',
          children_count: 1,
          children_completed: 1,
          is_milestone: true,
        }),
      ]),
    );
    expect(board.stage_summary).toEqual([
      expect.objectContaining({
        name: 'triage',
        status: 'active',
        is_active: true,
        gate_status: 'not_requested',
        work_item_count: 1,
        open_work_item_count: 1,
        completed_count: 0,
      }),
      expect.objectContaining({
        name: 'review',
        status: 'awaiting_gate',
        is_active: true,
        gate_status: 'awaiting_approval',
        work_item_count: 1,
        open_work_item_count: 0,
        completed_count: 1,
      }),
    ]);
  });

  it('keeps continuous detail active stages work-item driven while preserving gate counts', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              id: 'wf-1',
              tenant_id: 'tenant-1',
              playbook_id: 'pb-1',
              lifecycle: 'ongoing',
              current_stage: 'legacy-stage',
              metadata: {},
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              definition: {
                board: {
                  columns: [
                    { id: 'queued', label: 'Queued' },
                    { id: 'done', label: 'Done', is_terminal: true },
                  ],
                },
                stages: [
                  { name: 'triage', goal: 'Sort work' },
                  { name: 'review', goal: 'Review work' },
                ],
              },
            },
          ],
        }),
    };

    const service = new WorkflowService(pool as never, { emit: vi.fn() } as never, config as never);
    (service as unknown as { workItemService: { listWorkflowWorkItems: ReturnType<typeof vi.fn> } }).workItemService = {
      listWorkflowWorkItems: vi.fn().mockResolvedValue([
        { id: 'wi-1', stage_name: 'triage', column_id: 'queued', completed_at: null },
        { id: 'wi-2', stage_name: 'review', column_id: 'done', completed_at: '2026-03-11T00:00:00.000Z' },
      ]),
    };
    (service as unknown as { activationService: { listWorkflowActivations: ReturnType<typeof vi.fn> } }).activationService = {
      listWorkflowActivations: vi.fn().mockResolvedValue([]),
    };
    (service as unknown as { stageService: { listStages: ReturnType<typeof vi.fn> } }).stageService = {
      listStages: vi.fn().mockResolvedValue([
        { name: 'triage', goal: 'Sort work', gate_status: 'not_requested' },
        { name: 'review', goal: 'Review work', gate_status: 'awaiting_approval' },
      ]),
    };

    const workflow = await service.getWorkflow('tenant-1', 'wf-1');

    expect(workflow.active_stages).toEqual(['triage']);
    expect(workflow.work_item_summary).toEqual({
      total_work_items: 2,
      open_work_item_count: 1,
      blocked_work_item_count: 0,
      completed_work_item_count: 1,
      active_stage_count: 1,
      awaiting_gate_count: 1,
      active_stage_names: ['triage'],
    });
    expect(workflow.workflow_stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'review',
          gate_status: 'awaiting_approval',
        }),
      ]),
    );
  });

  it('reuses normalized workflow stage counts and gate posture for continuous board summaries', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              id: 'wf-1',
              tenant_id: 'tenant-1',
              playbook_id: 'pb-1',
              lifecycle: 'ongoing',
              current_stage: 'legacy-stage',
              metadata: {},
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              definition: {
                board: {
                  columns: [
                    { id: 'queued', label: 'Queued' },
                    { id: 'done', label: 'Done', is_terminal: true },
                  ],
                },
                stages: [
                  { name: 'triage', goal: 'Sort work' },
                  { name: 'review', goal: 'Review work' },
                ],
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              definition: {
                board: {
                  columns: [
                    { id: 'queued', label: 'Queued' },
                    { id: 'done', label: 'Done', is_terminal: true },
                  ],
                },
                stages: [
                  { name: 'triage', goal: 'Sort work' },
                  { name: 'review', goal: 'Review work' },
                ],
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              definition: {
                board: {
                  columns: [
                    { id: 'queued', label: 'Queued' },
                    { id: 'active', label: 'Active' },
                    { id: 'done', label: 'Done', is_terminal: true },
                  ],
                },
                stages: [
                  { name: 'triage', goal: 'Sort work' },
                  { name: 'implementation', goal: 'Do work' },
                ],
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              definition: {
                board: {
                  columns: [
                    { id: 'queued', label: 'Queued' },
                    { id: 'done', label: 'Done', is_terminal: true },
                  ],
                },
                stages: [
                  { name: 'triage', goal: 'Sort work' },
                  { name: 'review', goal: 'Review work' },
                ],
              },
            },
          ],
        }),
    };

    const service = new WorkflowService(pool as never, { emit: vi.fn() } as never, config as never);
    (service as unknown as { workItemService: { listWorkflowWorkItems: ReturnType<typeof vi.fn> } }).workItemService = {
      listWorkflowWorkItems: vi.fn().mockResolvedValue([
        { id: 'wi-1', stage_name: 'triage', column_id: 'queued', completed_at: null },
      ]),
    };
    (service as unknown as { activationService: { listWorkflowActivations: ReturnType<typeof vi.fn> } }).activationService = {
      listWorkflowActivations: vi.fn().mockResolvedValue([]),
    };
    (service as unknown as { stageService: { listStages: ReturnType<typeof vi.fn> } }).stageService = {
      listStages: vi.fn().mockResolvedValue([
        {
          name: 'triage',
          goal: 'Sort work',
          status: 'active',
          is_active: true,
          gate_status: 'not_requested',
          open_work_item_count: 4,
          total_work_item_count: 5,
        },
        {
          name: 'review',
          goal: 'Review work',
          status: 'awaiting_gate',
          is_active: true,
          gate_status: 'awaiting_approval',
          open_work_item_count: 0,
          total_work_item_count: 2,
        },
      ]),
    };

    const board = await service.getWorkflowBoard('tenant-1', 'wf-1');

    expect(board.stage_summary).toEqual([
      expect.objectContaining({
        name: 'triage',
        status: 'active',
        is_active: true,
        gate_status: 'not_requested',
        work_item_count: 5,
        open_work_item_count: 4,
        completed_count: 1,
      }),
      expect.objectContaining({
        name: 'review',
        status: 'awaiting_gate',
        is_active: true,
        gate_status: 'awaiting_approval',
        work_item_count: 2,
        open_work_item_count: 0,
        completed_count: 2,
      }),
    ]);
  });

  it('counts blocked_state work items as blocked in continuous workflow summaries', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              id: 'wf-1',
              tenant_id: 'tenant-1',
              playbook_id: 'pb-1',
              lifecycle: 'ongoing',
              current_stage: 'legacy-stage',
              metadata: {},
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              definition: {
                board: {
                  columns: [
                    { id: 'planned', label: 'Planned' },
                    { id: 'blocked', label: 'Blocked', is_blocked: true },
                    { id: 'done', label: 'Done', is_terminal: true },
                  ],
                },
                stages: [
                  { name: 'draft-revision', goal: 'Revise the draft' },
                  { name: 'publication', goal: 'Package the release' },
                ],
              },
            },
          ],
        }),
    };

    const service = new WorkflowService(pool as never, { emit: vi.fn() } as never, config as never);
    (service as unknown as { workItemService: { listWorkflowWorkItems: ReturnType<typeof vi.fn> } }).workItemService = {
      listWorkflowWorkItems: vi.fn().mockResolvedValue([
        {
          id: 'wi-1',
          stage_name: 'draft-revision',
          column_id: 'blocked',
          blocked_state: 'blocked',
          completed_at: null,
        },
      ]),
    };
    (service as unknown as { activationService: { listWorkflowActivations: ReturnType<typeof vi.fn> } }).activationService = {
      listWorkflowActivations: vi.fn().mockResolvedValue([]),
    };
    (service as unknown as { stageService: { listStages: ReturnType<typeof vi.fn> } }).stageService = {
      listStages: vi.fn().mockResolvedValue([
        { name: 'draft-revision', goal: 'Revise the draft', gate_status: 'not_requested' },
        { name: 'publication', goal: 'Package the release', gate_status: 'not_requested' },
      ]),
    };

    const workflow = await service.getWorkflow('tenant-1', 'wf-1');

    expect(workflow.work_item_summary).toEqual({
      total_work_items: 1,
      open_work_item_count: 1,
      blocked_work_item_count: 1,
      completed_work_item_count: 0,
      active_stage_count: 1,
      awaiting_gate_count: 0,
      active_stage_names: ['draft-revision'],
    });
  });

  it('keeps escalated open work items in their stored board lane', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              id: 'wf-1',
              tenant_id: 'tenant-1',
              playbook_id: 'pb-1',
              lifecycle: 'ongoing',
              current_stage: null,
              metadata: {},
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              definition: {
                board: {
                  columns: [
                    { id: 'planned', label: 'Planned' },
                    { id: 'active', label: 'In Progress' },
                    { id: 'blocked', label: 'Blocked', is_blocked: true },
                    { id: 'done', label: 'Done', is_terminal: true },
                  ],
                },
                stages: [{ name: 'triage', goal: 'Sort work' }],
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              definition: {
                board: {
                  columns: [
                    { id: 'planned', label: 'Planned' },
                    { id: 'active', label: 'In Progress' },
                    { id: 'blocked', label: 'Blocked', is_blocked: true },
                    { id: 'done', label: 'Done', is_terminal: true },
                  ],
                },
                stages: [{ name: 'triage', goal: 'Sort work' }],
              },
            },
          ],
        }),
    };

    const service = new WorkflowService(pool as never, { emit: vi.fn() } as never, config as never);
    (service as unknown as { workItemService: { listWorkflowWorkItems: ReturnType<typeof vi.fn> } }).workItemService = {
      listWorkflowWorkItems: vi.fn().mockResolvedValue([
        {
          id: 'wi-escalated',
          stage_name: 'triage',
          column_id: 'planned',
          escalation_status: 'open',
          completed_at: null,
        },
      ]),
    };
    (service as unknown as { activationService: { listWorkflowActivations: ReturnType<typeof vi.fn> } }).activationService = {
      listWorkflowActivations: vi.fn().mockResolvedValue([]),
    };
    (service as unknown as { stageService: { listStages: ReturnType<typeof vi.fn> } }).stageService = {
      listStages: vi.fn().mockResolvedValue([
        { name: 'triage', goal: 'Sort work', status: 'active', gate_status: 'not_requested' },
      ]),
    };

    const board = await service.getWorkflowBoard('tenant-1', 'wf-1');

    expect(board.work_items).toEqual([
      expect.objectContaining({
        id: 'wi-escalated',
        column_id: 'planned',
        escalation_status: 'open',
      }),
    ]);
  });

  it('keeps request-changes work in its stored lane when the board has no blocked lane', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              id: 'wf-1',
              tenant_id: 'tenant-1',
              playbook_id: 'pb-1',
              lifecycle: 'planned',
              current_stage: 'implementation',
              metadata: {},
              state: 'active',
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              definition: {
                board: {
                  columns: [
                    { id: 'planned', label: 'Planned' },
                    { id: 'active', label: 'In Progress' },
                    { id: 'done', label: 'Done', is_terminal: true },
                  ],
                },
                stages: [{ name: 'implementation', goal: 'Implement work' }],
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              definition: {
                board: {
                  columns: [
                    { id: 'planned', label: 'Planned' },
                    { id: 'active', label: 'In Progress' },
                    { id: 'done', label: 'Done', is_terminal: true },
                  ],
                },
                stages: [{ name: 'implementation', goal: 'Implement work' }],
              },
            },
          ],
        }),
    };

    const service = new WorkflowService(pool as never, { emit: vi.fn() } as never, config as never);
    (service as unknown as { workItemService: { listWorkflowWorkItems: ReturnType<typeof vi.fn> } }).workItemService = {
      listWorkflowWorkItems: vi.fn().mockResolvedValue([
        {
          id: 'wi-request-changes',
          stage_name: 'implementation',
          column_id: 'planned',
          gate_status: 'changes_requested',
          completed_at: null,
        },
      ]),
    };
    (service as unknown as { activationService: { listWorkflowActivations: ReturnType<typeof vi.fn> } }).activationService = {
      listWorkflowActivations: vi.fn().mockResolvedValue([]),
    };
    (service as unknown as { stageService: { listStages: ReturnType<typeof vi.fn> } }).stageService = {
      listStages: vi.fn().mockResolvedValue([
        { name: 'implementation', goal: 'Implement work', status: 'active', gate_status: 'changes_requested' },
      ]),
    };

    const board = await service.getWorkflowBoard('tenant-1', 'wf-1');

    expect(board.work_items).toEqual([
      expect.objectContaining({
        id: 'wi-request-changes',
        column_id: 'planned',
        gate_status: 'changes_requested',
      }),
    ]);
  });

  it('keeps paused workflow work in its current active lane instead of reprojecting to blocked', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              id: 'wf-1',
              tenant_id: 'tenant-1',
              playbook_id: 'pb-1',
              lifecycle: 'planned',
              current_stage: 'implementation',
              metadata: { pause_requested_at: '2026-03-27T04:00:00.000Z' },
              state: 'paused',
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              definition: {
                board: {
                  columns: [
                    { id: 'planned', label: 'Planned' },
                    { id: 'active', label: 'In Progress' },
                    { id: 'blocked', label: 'Blocked', is_blocked: true },
                    { id: 'done', label: 'Done', is_terminal: true },
                  ],
                },
                stages: [{ name: 'implementation', goal: 'Implement work' }],
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              definition: {
                board: {
                  columns: [
                    { id: 'planned', label: 'Planned' },
                    { id: 'active', label: 'In Progress' },
                    { id: 'blocked', label: 'Blocked', is_blocked: true },
                    { id: 'done', label: 'Done', is_terminal: true },
                  ],
                },
                stages: [{ name: 'implementation', goal: 'Implement work' }],
              },
            },
          ],
        }),
    };

    const service = new WorkflowService(pool as never, { emit: vi.fn() } as never, config as never);
    (service as unknown as { workItemService: { listWorkflowWorkItems: ReturnType<typeof vi.fn> } }).workItemService = {
      listWorkflowWorkItems: vi.fn().mockResolvedValue([
        {
          id: 'wi-paused',
          stage_name: 'implementation',
          column_id: 'active',
          gate_status: 'changes_requested',
          completed_at: null,
        },
      ]),
    };
    (service as unknown as { activationService: { listWorkflowActivations: ReturnType<typeof vi.fn> } }).activationService = {
      listWorkflowActivations: vi.fn().mockResolvedValue([]),
    };
    (service as unknown as { stageService: { listStages: ReturnType<typeof vi.fn> } }).stageService = {
      listStages: vi.fn().mockResolvedValue([
        { name: 'implementation', goal: 'Implement work', status: 'active', gate_status: 'changes_requested' },
      ]),
    };

    const board = await service.getWorkflowBoard('tenant-1', 'wf-1');

    expect(board.work_items).toEqual([
      expect.objectContaining({
        id: 'wi-paused',
        column_id: 'active',
        gate_status: 'changes_requested',
      }),
    ]);
  });

  it('keeps resumed work in its stored active lane while the next step is still being orchestrated', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              id: 'wf-1',
              tenant_id: 'tenant-1',
              playbook_id: 'pb-1',
              lifecycle: 'planned',
              current_stage: 'implementation',
              metadata: {},
              state: 'active',
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              definition: {
                board: {
                  columns: [
                    { id: 'planned', label: 'Planned' },
                    { id: 'active', label: 'In Progress' },
                    { id: 'blocked', label: 'Blocked', is_blocked: true },
                    { id: 'done', label: 'Done', is_terminal: true },
                  ],
                },
                stages: [{ name: 'implementation', goal: 'Implement work' }],
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              definition: {
                board: {
                  columns: [
                    { id: 'planned', label: 'Planned' },
                    { id: 'active', label: 'In Progress' },
                    { id: 'blocked', label: 'Blocked', is_blocked: true },
                    { id: 'done', label: 'Done', is_terminal: true },
                  ],
                },
                stages: [{ name: 'implementation', goal: 'Implement work' }],
              },
            },
          ],
        }),
    };

    const service = new WorkflowService(pool as never, { emit: vi.fn() } as never, config as never);
    (service as unknown as { workItemService: { listWorkflowWorkItems: ReturnType<typeof vi.fn> } }).workItemService = {
      listWorkflowWorkItems: vi.fn().mockResolvedValue([
        {
          id: 'wi-resumed',
          stage_name: 'implementation',
          column_id: 'active',
          completed_at: null,
        },
      ]),
    };
    (service as unknown as { activationService: { listWorkflowActivations: ReturnType<typeof vi.fn> } }).activationService = {
      listWorkflowActivations: vi.fn().mockResolvedValue([
        {
          id: 'activation-1',
          status: 'active',
        },
      ]),
    };
    (service as unknown as { stageService: { listStages: ReturnType<typeof vi.fn> } }).stageService = {
      listStages: vi.fn().mockResolvedValue([
        { name: 'implementation', goal: 'Implement work', status: 'active', gate_status: 'not_requested' },
      ]),
    };

    const board = await service.getWorkflowBoard('tenant-1', 'wf-1');

    expect(board.work_items).toEqual([
      expect.objectContaining({
        id: 'wi-resumed',
        column_id: 'active',
      }),
    ]);
  });

  it('builds large continuous workflow boards with bounded service fanout', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              id: 'wf-1',
              tenant_id: 'tenant-1',
              playbook_id: 'pb-1',
              lifecycle: 'ongoing',
              current_stage: 'legacy-stage',
              metadata: {},
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              definition: {
                board: {
                  columns: [
                    { id: 'queued', label: 'Queued' },
                    { id: 'active', label: 'Active' },
                    { id: 'done', label: 'Done', is_terminal: true },
                  ],
                },
                stages: [
                  { name: 'triage', goal: 'Sort work' },
                  { name: 'implementation', goal: 'Do work' },
                ],
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              definition: {
                board: {
                  columns: [
                    { id: 'queued', label: 'Queued' },
                    { id: 'active', label: 'Active' },
                    { id: 'done', label: 'Done', is_terminal: true },
                  ],
                },
                stages: [
                  { name: 'triage', goal: 'Sort work' },
                  { name: 'implementation', goal: 'Do work' },
                ],
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              definition: {
                board: {
                  columns: [
                    { id: 'queued', label: 'Queued' },
                    { id: 'active', label: 'Active' },
                    { id: 'done', label: 'Done', is_terminal: true },
                  ],
                },
                stages: [
                  { name: 'triage', goal: 'Sort work' },
                  { name: 'implementation', goal: 'Do work' },
                ],
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              definition: {
                board: {
                  columns: [
                    { id: 'queued', label: 'Queued' },
                    { id: 'active', label: 'Active' },
                    { id: 'done', label: 'Done', is_terminal: true },
                  ],
                },
                stages: [
                  { name: 'triage', goal: 'Sort work' },
                  { name: 'implementation', goal: 'Do work' },
                  { name: 'review', goal: 'Review work' },
                ],
              },
            },
          ],
        }),
    };

    const workItems = Array.from({ length: 600 }, (_, index) => ({
      id: `wi-${index}`,
      stage_name: ['triage', 'implementation', 'review'][index % 3],
      column_id: index % 5 === 0 ? 'done' : index % 2 === 0 ? 'active' : 'queued',
      completed_at: index % 5 === 0 ? '2026-03-11T00:00:00.000Z' : null,
      parent_work_item_id: index > 0 && index % 10 === 0 ? 'wi-0' : null,
    }));
    const listWorkflowWorkItems = vi.fn().mockResolvedValue(workItems);
    const listWorkflowActivations = vi.fn().mockResolvedValue([]);
    const listStages = vi.fn().mockResolvedValue([
      { name: 'triage', goal: 'Sort work', status: 'active', gate_status: 'not_requested' },
      { name: 'implementation', goal: 'Do work', status: 'active', gate_status: 'not_requested' },
      { name: 'review', goal: 'Review work', status: 'awaiting_gate', gate_status: 'awaiting_approval' },
    ]);

    const service = new WorkflowService(pool as never, { emit: vi.fn() } as never, config as never);
    (service as unknown as { workItemService: { listWorkflowWorkItems: typeof listWorkflowWorkItems } }).workItemService =
      {
        listWorkflowWorkItems,
      };
    (service as unknown as { activationService: { listWorkflowActivations: typeof listWorkflowActivations } }).activationService =
      {
        listWorkflowActivations,
      };
    (service as unknown as { stageService: { listStages: typeof listStages } }).stageService = {
      listStages,
    };

    const board = await service.getWorkflowBoard('tenant-1', 'wf-1');

    expect(pool.query).toHaveBeenCalledTimes(4);
    expect(listWorkflowWorkItems).toHaveBeenCalledTimes(1);
    expect(listWorkflowActivations).toHaveBeenCalledTimes(1);
    expect(listStages).toHaveBeenCalledTimes(1);
    expect(board.work_items).toHaveLength(600);
    expect(board.active_stages.slice().sort()).toEqual(['implementation', 'review', 'triage']);
    expect(board.awaiting_gate_count).toBe(1);
    expect(board.stage_summary).toEqual([
      expect.objectContaining({
        name: 'triage',
        work_item_count: 200,
        completed_count: 40,
        open_work_item_count: 160,
      }),
      expect.objectContaining({
        name: 'implementation',
        work_item_count: 200,
        completed_count: 40,
        open_work_item_count: 160,
      }),
      expect.objectContaining({
        name: 'review',
        work_item_count: 200,
        completed_count: 40,
        open_work_item_count: 160,
        gate_status: 'awaiting_approval',
      }),
    ]);
  });

  it('aggregates large milestone child counts in one board read without extra service fanout', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              id: 'wf-1',
              tenant_id: 'tenant-1',
              playbook_id: 'pb-1',
              lifecycle: 'ongoing',
              current_stage: null,
              metadata: {},
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              definition: {
                board: {
                  columns: [
                    { id: 'queued', label: 'Queued' },
                    { id: 'active', label: 'Active' },
                    { id: 'done', label: 'Done', is_terminal: true },
                  ],
                },
                stages: [
                  { name: 'triage', goal: 'Sort work' },
                  { name: 'implementation', goal: 'Do work' },
                ],
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              definition: {
                board: {
                  columns: [
                    { id: 'queued', label: 'Queued' },
                    { id: 'active', label: 'Active' },
                    { id: 'done', label: 'Done', is_terminal: true },
                  ],
                },
                stages: [
                  { name: 'triage', goal: 'Sort work' },
                  { name: 'implementation', goal: 'Do work' },
                ],
              },
            },
          ],
        }),
    };

    const workItems = [
      {
        id: 'wi-parent',
        stage_name: 'triage',
        column_id: 'active',
        completed_at: null,
      },
      ...Array.from({ length: 1_000 }, (_, index) => ({
        id: `wi-child-${index}`,
        parent_work_item_id: 'wi-parent',
        stage_name: 'implementation',
        column_id: index % 2 === 0 ? 'done' : 'active',
        completed_at: index % 2 === 0 ? '2026-03-11T00:00:00.000Z' : null,
      })),
    ];
    const listWorkflowWorkItems = vi.fn().mockResolvedValue(workItems);
    const listWorkflowActivations = vi.fn().mockResolvedValue([]);
    const listStages = vi.fn().mockResolvedValue([
      { name: 'triage', goal: 'Sort work', status: 'active', gate_status: 'not_requested' },
      { name: 'implementation', goal: 'Do work', status: 'active', gate_status: 'not_requested' },
    ]);

    const service = new WorkflowService(pool as never, { emit: vi.fn() } as never, config as never);
    (service as unknown as { workItemService: { listWorkflowWorkItems: typeof listWorkflowWorkItems } }).workItemService =
      {
        listWorkflowWorkItems,
      };
    (service as unknown as { activationService: { listWorkflowActivations: typeof listWorkflowActivations } }).activationService =
      {
        listWorkflowActivations,
      };
    (service as unknown as { stageService: { listStages: typeof listStages } }).stageService = {
      listStages,
    };

    const board = await service.getWorkflowBoard('tenant-1', 'wf-1');
    const parent = board.work_items.find((item) => item.id === 'wi-parent');

    expect(pool.query).toHaveBeenCalledTimes(4);
    expect(listWorkflowWorkItems).toHaveBeenCalledTimes(1);
    expect(listWorkflowActivations).toHaveBeenCalledTimes(1);
    expect(listStages).toHaveBeenCalledTimes(1);
    expect(board.work_items).toHaveLength(1_001);
    expect(parent).toEqual(
      expect.objectContaining({
        id: 'wi-parent',
        children_count: 1_000,
        children_completed: 500,
        is_milestone: true,
      }),
    );
    expect(board.stage_summary).toEqual([
      expect.objectContaining({
        name: 'triage',
        work_item_count: 1,
        open_work_item_count: 1,
        completed_count: 0,
      }),
      expect.objectContaining({
        name: 'implementation',
        work_item_count: 1_000,
        open_work_item_count: 500,
        completed_count: 500,
      }),
    ]);
  });

  it('keeps continuous board stage counts aligned with detail summary when completed work items are not in terminal columns', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM workflows') && sql.includes('WHERE tenant_id = $1 AND id = $2')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'wf-1',
                tenant_id: 'tenant-1',
                playbook_id: 'pb-1',
                lifecycle: 'ongoing',
                current_stage: null,
                metadata: {},
              },
            ],
          };
        }
        if (sql.includes('FROM tasks')) {
          return { rows: [] };
        }
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          return {
            rowCount: 1,
            rows: [
              {
                definition: {
                  board: {
                    columns: [
                      { id: 'queued', label: 'Queued' },
                      { id: 'active', label: 'Active' },
                      { id: 'done', label: 'Done', is_terminal: true },
                    ],
                  },
                  stages: [
                    { name: 'implementation', goal: 'Do work' },
                    { name: 'review', goal: 'Review work' },
                  ],
                },
              },
            ],
          };
        }
        if (sql.includes('SELECT definition') && sql.includes('FROM playbooks')) {
          return {
            rowCount: 1,
            rows: [
              {
                definition: {
                  board: {
                    columns: [
                      { id: 'queued', label: 'Queued' },
                      { id: 'active', label: 'Active' },
                      { id: 'done', label: 'Done', is_terminal: true },
                    ],
                  },
                  stages: [
                    { name: 'implementation', goal: 'Do work' },
                    { name: 'review', goal: 'Review work' },
                  ],
                },
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    const workItems = [
      {
        id: 'wi-1',
        stage_name: 'implementation',
        column_id: 'active',
        completed_at: '2026-03-11T00:00:00.000Z',
      },
      {
        id: 'wi-2',
        stage_name: 'implementation',
        column_id: 'active',
        completed_at: null,
      },
      {
        id: 'wi-3',
        stage_name: 'review',
        column_id: 'queued',
        completed_at: null,
      },
    ];

    const service = new WorkflowService(pool as never, { emit: vi.fn() } as never, config as never);
    (service as unknown as { workItemService: { listWorkflowWorkItems: ReturnType<typeof vi.fn> } }).workItemService = {
      listWorkflowWorkItems: vi.fn().mockResolvedValue(workItems),
    };
    (service as unknown as { activationService: { listWorkflowActivations: ReturnType<typeof vi.fn> } }).activationService = {
      listWorkflowActivations: vi.fn().mockResolvedValue([]),
    };
    (service as unknown as { stageService: { listStages: ReturnType<typeof vi.fn> } }).stageService = {
      listStages: vi.fn().mockResolvedValue([
        {
          name: 'implementation',
          goal: 'Do work',
          status: 'active',
          gate_status: 'not_requested',
        },
        {
          name: 'review',
          goal: 'Review work',
          status: 'awaiting_gate',
          gate_status: 'awaiting_approval',
        },
      ]),
    };

    const workflow = await service.getWorkflow('tenant-1', 'wf-1');
    const board = await service.getWorkflowBoard('tenant-1', 'wf-1');

    expect(workflow.work_item_summary).toEqual({
      total_work_items: 3,
      open_work_item_count: 2,
      blocked_work_item_count: 0,
      completed_work_item_count: 1,
      active_stage_count: 2,
      awaiting_gate_count: 1,
      active_stage_names: ['implementation', 'review'],
    });
    expect(board.awaiting_gate_count).toBe(1);
    expect(board.stage_summary).toEqual([
      expect.objectContaining({
        name: 'implementation',
        work_item_count: 2,
        open_work_item_count: 1,
        completed_count: 1,
      }),
      expect.objectContaining({
        name: 'review',
        work_item_count: 1,
        open_work_item_count: 1,
        completed_count: 0,
        gate_status: 'awaiting_approval',
      }),
    ]);
  });
});
