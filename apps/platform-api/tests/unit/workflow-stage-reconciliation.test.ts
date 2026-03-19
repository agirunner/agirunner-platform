import { describe, expect, it, vi } from 'vitest';

import { reconcilePlannedWorkflowStages } from '../../src/services/workflow-stage-reconciliation.js';

describe('reconcilePlannedWorkflowStages', () => {
  it('derives the active planned stage from normalized stage rows without writing workflow.current_stage', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('SELECT ws.id')) {
          return {
            rowCount: 2,
            rows: [
              {
                id: 'stage-1',
                lifecycle: 'planned',
                name: 'design',
                position: 0,
                goal: 'Design',
                guidance: null,
                human_gate: false,
                status: 'active',
                gate_status: 'not_requested',
                iteration_count: 0,
                summary: null,
                started_at: new Date('2026-03-11T00:00:00Z'),
                completed_at: null,
                open_work_item_count: 1,
                total_work_item_count: 1,
                first_work_item_at: new Date('2026-03-11T00:00:00Z'),
                last_completed_work_item_at: null,
              },
              {
                id: 'stage-2',
                lifecycle: 'planned',
                name: 'implementation',
                position: 1,
                goal: 'Implement',
                guidance: null,
                human_gate: false,
                status: 'pending',
                gate_status: 'not_requested',
                iteration_count: 0,
                summary: null,
                started_at: null,
                completed_at: null,
                open_work_item_count: 0,
                total_work_item_count: 0,
                first_work_item_at: null,
                last_completed_work_item_at: null,
              },
            ],
          };
        }
        if (sql.includes('UPDATE workflows')) {
          throw new Error('planned workflow reconciliation should not persist workflow.current_stage');
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const result = await reconcilePlannedWorkflowStages(pool as never, 'tenant-1', 'workflow-1');

    expect(result).toEqual({
      currentStage: 'design',
      stages: [
        expect.objectContaining({
          name: 'design',
          status: 'active',
          is_active: true,
        }),
        expect.objectContaining({
          name: 'implementation',
          status: 'pending',
          is_active: false,
        }),
      ],
    });
  });

  it('keeps a planned active stage current until advance_stage explicitly completes it', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('SELECT ws.id')) {
          return {
            rowCount: 2,
            rows: [
              {
                id: 'stage-1',
                lifecycle: 'planned',
                name: 'implementation',
                position: 0,
                goal: 'Implement',
                guidance: null,
                human_gate: false,
                status: 'active',
                gate_status: 'not_requested',
                iteration_count: 0,
                summary: null,
                started_at: new Date('2026-03-11T00:00:00Z'),
                completed_at: null,
                open_work_item_count: 0,
                total_work_item_count: 1,
                first_work_item_at: new Date('2026-03-11T00:00:00Z'),
                last_completed_work_item_at: new Date('2026-03-11T00:30:00Z'),
              },
              {
                id: 'stage-2',
                lifecycle: 'planned',
                name: 'review',
                position: 1,
                goal: 'Review',
                guidance: null,
                human_gate: false,
                status: 'pending',
                gate_status: 'not_requested',
                iteration_count: 0,
                summary: null,
                started_at: null,
                completed_at: null,
                open_work_item_count: 0,
                total_work_item_count: 0,
                first_work_item_at: null,
                last_completed_work_item_at: null,
              },
            ],
          };
        }
        if (sql.includes('UPDATE workflows')) {
          throw new Error('planned workflow reconciliation should not persist workflow.current_stage');
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const result = await reconcilePlannedWorkflowStages(pool as never, 'tenant-1', 'workflow-1');

    expect(result).toEqual({
      currentStage: 'implementation',
      stages: [
        expect.objectContaining({
          name: 'implementation',
          status: 'active',
          is_active: true,
        }),
        expect.objectContaining({
          name: 'review',
          status: 'pending',
          is_active: false,
        }),
      ],
    });
  });
});
