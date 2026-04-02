import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { WorkflowService } from '../../../src/services/workflow-service/workflow-service.js';

const config = {
  TASK_DEFAULT_TIMEOUT_MINUTES: 30,
  ARTIFACT_STORAGE_BACKEND: 'local' as const,
  ARTIFACT_LOCAL_ROOT: resolve('tmp'),
};

describe('WorkflowService continuous workflow reads', () => {
  it('keeps workflow detail task reads operator-facing while redacting kept task fields', async () => {
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
              workspace_id: 'workspace-1',
              parent_id: 'task-parent',
              work_item_id: 'work-item-1',
              activation_id: 'activation-1',
              title: 'Review the fix',
              description: 'Confirm the chunking change is safe.',
              state: 'in_progress',
              priority: 'critical',
              execution_backend: 'runtime_plus_task',
              used_task_sandbox: true,
              role: 'Code Reviewer',
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
              assigned_agent_id: 'agent-1',
              assigned_worker_id: 'worker-1',
              depends_on: ['task-parent', 7, null],
              timeout_minutes: 180,
              auto_retry: true,
              max_retries: 5,
              retry_count: 2,
              claimed_at: '2026-03-31T00:00:00.000Z',
              started_at: '2026-03-31T00:01:00.000Z',
              completed_at: null,
              failed_at: null,
              cancelled_at: null,
              created_at: '2026-03-31T00:00:00.000Z',
              updated_at: '2026-03-31T00:05:00.000Z',
              stage_name: 'review',
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
      {
        id: 'task-1',
        tenant_id: 'tenant-1',
        workflow_id: 'wf-1',
        workspace_id: 'workspace-1',
        parent_id: 'task-parent',
        work_item_id: 'work-item-1',
        activation_id: 'activation-1',
        title: 'Review the fix',
        description: 'Confirm the chunking change is safe.',
        state: 'in_progress',
        priority: 'critical',
        execution_backend: 'runtime_plus_task',
        used_task_sandbox: true,
        role: 'Code Reviewer',
        input: {
          api_key: 'redacted://task-secret',
          api_key_secret_ref: 'redacted://task-secret',
        },
        metadata: {
          refresh_token: 'redacted://task-secret',
          secret_ref: 'redacted://task-secret',
        },
        assigned_agent_id: 'agent-1',
        assigned_worker_id: 'worker-1',
        depends_on: ['task-parent'],
        timeout_minutes: 180,
        auto_retry: true,
        max_retries: 5,
        retry_count: 2,
        claimed_at: '2026-03-31T00:00:00.000Z',
        started_at: '2026-03-31T00:01:00.000Z',
        completed_at: null,
        failed_at: null,
        cancelled_at: null,
        created_at: '2026-03-31T00:00:00.000Z',
        updated_at: '2026-03-31T00:05:00.000Z',
        stage_name: 'review',
      },
    ]);
    const tasks = workflow.tasks as Array<Record<string, unknown>>;
    expect(tasks[0]).not.toHaveProperty('context');
    expect(tasks[0]).not.toHaveProperty('output');
    expect(tasks[0]).not.toHaveProperty('error');
    expect(tasks[0]).not.toHaveProperty('role_config');
    expect(tasks[0]).not.toHaveProperty('environment');
    expect(tasks[0]).not.toHaveProperty('resource_bindings');
    expect(tasks[0]).not.toHaveProperty('metrics');
    expect(tasks[0]).not.toHaveProperty('git_info');
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
});
