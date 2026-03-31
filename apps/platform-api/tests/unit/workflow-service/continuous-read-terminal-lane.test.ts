import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { WorkflowService } from '../../../src/services/workflow-service/workflow-service.js';

const config = {
  TASK_DEFAULT_TIMEOUT_MINUTES: 30,
  ARTIFACT_STORAGE_BACKEND: 'local' as const,
  ARTIFACT_LOCAL_ROOT: resolve('tmp'),
};

describe('WorkflowService continuous workflow reads', () => {
  it('projects cancelled workflow work into the terminal lane while preserving a cancelled marker', async () => {
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
              metadata: { cancel_requested_at: '2026-03-29T18:00:00.000Z' },
              state: 'cancelled',
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
          id: 'wi-cancelled',
          stage_name: 'implementation',
          column_id: 'active',
          completed_at: null,
        },
      ]),
    };
    (service as unknown as { activationService: { listWorkflowActivations: ReturnType<typeof vi.fn> } }).activationService = {
      listWorkflowActivations: vi.fn().mockResolvedValue([]),
    };
    (service as unknown as { stageService: { listStages: ReturnType<typeof vi.fn> } }).stageService = {
      listStages: vi.fn().mockResolvedValue([
        { name: 'implementation', goal: 'Implement work', status: 'active', gate_status: 'not_requested' },
      ]),
    };

    const board = await service.getWorkflowBoard('tenant-1', 'wf-1');

    expect(board.work_items).toEqual([
      expect.objectContaining({
        id: 'wi-cancelled',
        column_id: 'done',
      }),
    ]);
  });

  it('treats stale terminal-column work without completed_at as reopened active work', async () => {
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
          id: 'wi-reopened',
          stage_name: 'implementation',
          column_id: 'done',
          completed_at: null,
        },
      ]),
    };
    (service as unknown as { activationService: { listWorkflowActivations: ReturnType<typeof vi.fn> } }).activationService = {
      listWorkflowActivations: vi.fn().mockResolvedValue([]),
    };
    (service as unknown as { stageService: { listStages: ReturnType<typeof vi.fn> } }).stageService = {
      listStages: vi.fn().mockResolvedValue([
        { name: 'implementation', goal: 'Implement work', status: 'active', gate_status: 'not_requested' },
      ]),
    };

    const workflow = await service.getWorkflow('tenant-1', 'wf-1');
    const board = await service.getWorkflowBoard('tenant-1', 'wf-1');

    expect(workflow.work_item_summary).toEqual({
      total_work_items: 1,
      open_work_item_count: 1,
      blocked_work_item_count: 0,
      completed_work_item_count: 0,
      active_stage_count: 1,
      awaiting_gate_count: 0,
      active_stage_names: ['implementation'],
    });
    expect(board.work_items).toEqual([
      expect.objectContaining({
        id: 'wi-reopened',
        column_id: 'active',
        completed_at: null,
      }),
    ]);
  });

  it('projects terminal completed and failed workflow work into the terminal lane', async () => {
    const runBoardProjection = async (workflowState: 'completed' | 'failed') => {
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
                state: workflowState,
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
            id: `wi-${workflowState}`,
            stage_name: 'implementation',
            column_id: 'planned',
            completed_at: null,
          },
        ]),
      };
      (service as unknown as { activationService: { listWorkflowActivations: ReturnType<typeof vi.fn> } }).activationService = {
        listWorkflowActivations: vi.fn().mockResolvedValue([]),
      };
      (service as unknown as { stageService: { listStages: ReturnType<typeof vi.fn> } }).stageService = {
        listStages: vi.fn().mockResolvedValue([
          { name: 'implementation', goal: 'Implement work', status: 'active', gate_status: 'not_requested' },
        ]),
      };

      return service.getWorkflowBoard('tenant-1', 'wf-1');
    };

    const completedBoard = await runBoardProjection('completed');
    const failedBoard = await runBoardProjection('failed');

    expect(completedBoard.work_items).toEqual([
      expect.objectContaining({
        id: 'wi-completed',
        column_id: 'done',
      }),
    ]);
    expect(failedBoard.work_items).toEqual([
      expect.objectContaining({
        id: 'wi-failed',
        column_id: 'done',
      }),
    ]);
  });
});
