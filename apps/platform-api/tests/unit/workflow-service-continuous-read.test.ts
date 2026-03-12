import { describe, expect, it, vi } from 'vitest';

import { WorkflowService } from '../../src/services/workflow-service.js';

const config = {
  TASK_DEFAULT_TIMEOUT_MINUTES: 30,
  ARTIFACT_STORAGE_BACKEND: 'local' as const,
  ARTIFACT_LOCAL_ROOT: '/tmp',
};

describe('WorkflowService continuous workflow reads', () => {
  it('removes workflow-global current_stage on workflow lists and exposes derived active stages', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ total: '1' }] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'wf-1',
              tenant_id: 'tenant-1',
              lifecycle: 'continuous',
              current_stage: 'legacy-stage',
              work_item_summary: {
                total_work_items: 3,
                open_work_item_count: 2,
                completed_work_item_count: 1,
                active_stage_count: 99,
                awaiting_gate_count: 1,
                active_stage_names: ['triage', 'implementation'],
              },
              metadata: {},
            },
          ],
        }),
    };

    const service = new WorkflowService(pool as never, { emit: vi.fn() } as never, config as never);
    const result = await service.listWorkflows('tenant-1', { page: 1, per_page: 20 });

    expect(result.data[0]).not.toHaveProperty('current_stage');
    expect(result.data[0].active_stages).toEqual(['triage', 'implementation']);
    expect(result.data[0].work_item_summary).toEqual({
      total_work_items: 3,
      open_work_item_count: 2,
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
              lifecycle: 'continuous',
              current_stage: 'legacy-stage',
              metadata: {},
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }),
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
      completed_work_item_count: 1,
      active_stage_count: 2,
      awaiting_gate_count: 1,
      active_stage_names: ['triage', 'implementation'],
    });
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
              lifecycle: 'continuous',
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

    expect(board.active_stages).toEqual(['triage', 'review']);
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
});
