import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { WorkflowService } from '../../../src/services/workflow-service.js';

const config = {
  TASK_DEFAULT_TIMEOUT_MINUTES: 30,
  ARTIFACT_STORAGE_BACKEND: 'local' as const,
  ARTIFACT_LOCAL_ROOT: resolve('tmp'),
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

    expect(result.data[0]).not.toHaveProperty('current_stage');
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
              work_item_summary: {
                total_work_items: 1,
                open_work_item_count: 0,
                blocked_work_item_count: 0,
                completed_work_item_count: 1,
                awaiting_gate_count: 0,
                active_stage_names: [],
              },
            },
          ],
        })
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
              work_item_summary: {
                total_work_items: 1,
                open_work_item_count: 0,
                blocked_work_item_count: 0,
                completed_work_item_count: 1,
                awaiting_gate_count: 0,
                active_stage_names: [],
              },
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
              id: 'wf-1',
              tenant_id: 'tenant-1',
              playbook_id: 'pb-1',
              lifecycle: 'planned',
              current_stage: 'implementation',
              metadata: {},
              state: 'active',
              work_item_summary: {
                total_work_items: 1,
                open_work_item_count: 0,
                blocked_work_item_count: 0,
                completed_work_item_count: 1,
                awaiting_gate_count: 0,
                active_stage_names: [],
              },
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

    expect(workflow).not.toHaveProperty('current_stage');
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
});
