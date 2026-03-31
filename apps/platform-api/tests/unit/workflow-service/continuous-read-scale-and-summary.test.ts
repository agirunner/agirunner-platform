import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { WorkflowService } from '../../../src/services/workflow-service.js';

const config = {
  TASK_DEFAULT_TIMEOUT_MINUTES: 30,
  ARTIFACT_STORAGE_BACKEND: 'local' as const,
  ARTIFACT_LOCAL_ROOT: resolve('tmp'),
};

describe('WorkflowService continuous workflow reads', () => {
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
