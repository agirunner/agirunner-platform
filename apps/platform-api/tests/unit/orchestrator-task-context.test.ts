import { describe, expect, it, vi } from 'vitest';

import { buildOrchestratorTaskContext } from '../../src/services/orchestrator-task-context.js';

describe('buildOrchestratorTaskContext', () => {
  it('derives active stages from open work items only for continuous workflows', async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM workflows w')) {
          return {
            rows: [{
              id: 'workflow-1',
              name: 'Workflow One',
              lifecycle: 'ongoing',
              metadata: {},
              playbook_name: 'Continuous Flow',
              playbook_outcome: 'Ship work',
              playbook_definition: {
                board: { columns: [{ id: 'todo', label: 'Todo' }] },
                stages: [
                  { name: 'triage', goal: 'Sort incoming work' },
                  { name: 'implementation', goal: 'Implement work' },
                  { name: 'review', goal: 'Review work' },
                ],
                lifecycle: 'ongoing',
              },
            }],
          };
        }
        if (sql.includes('FROM workflow_activations')) {
          return {
            rows: [
              {
                id: 'activation-1',
                activation_id: 'activation-1',
                reason: 'work_item.created',
                event_type: 'work_item.created',
                payload: { work_item_id: 'wi-1' },
                state: 'processing',
                dispatch_attempt: 2,
                dispatch_token: 'dispatch-token-1',
                queued_at: new Date('2026-03-11T00:00:00Z'),
                started_at: new Date('2026-03-11T00:00:05Z'),
                consumed_at: null,
                completed_at: null,
                summary: null,
                error: null,
              },
            ],
          };
        }
        if (sql.includes('FROM workflow_stages')) {
          return {
            rows: [
              {
                id: 'stage-1',
                lifecycle: 'ongoing',
                name: 'triage',
                position: 0,
                goal: 'Sort incoming work',
                guidance: null,
                human_gate: false,
                status: 'pending',
                gate_status: 'not_requested',
                iteration_count: 0,
                summary: null,
                started_at: null,
                completed_at: null,
                open_work_item_count: 2,
                total_work_item_count: 2,
                first_work_item_at: new Date('2026-03-11T00:00:00Z'),
                last_completed_work_item_at: null,
              },
              {
                id: 'stage-2',
                lifecycle: 'ongoing',
                name: 'review',
                position: 2,
                goal: 'Review work',
                guidance: null,
                human_gate: true,
                status: 'pending',
                gate_status: 'awaiting_approval',
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
        if (sql.includes('FROM workflow_work_items')) {
          return {
            rows: [
              {
                id: 'wi-1',
                stage_name: 'implementation',

                next_expected_actor: 'reviewer',
                next_expected_action: 'review',
                rework_count: 1,
                completed_at: null,
              },
              {
                id: 'wi-2',
                stage_name: 'triage',

                next_expected_actor: null,
                next_expected_action: null,
                rework_count: 0,
                completed_at: null,
              },
              {
                id: 'wi-3',
                stage_name: 'triage',

                next_expected_actor: null,
                next_expected_action: null,
                rework_count: 0,
                completed_at: null,
              },
              {
                id: 'wi-4',
                stage_name: 'done',

                next_expected_actor: null,
                next_expected_action: null,
                rework_count: 0,
                completed_at: '2026-03-11T00:00:00.000Z',
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    const context = await buildOrchestratorTaskContext(db as never, 'tenant-1', {
      id: 'task-1',
      workflow_id: 'workflow-1',
      is_orchestrator_task: true,
      activation_id: 'activation-1',
    });

    expect(context?.workflow).toEqual(
      expect.objectContaining({
        lifecycle: 'ongoing',
        active_stages: ['triage', 'implementation'],
      }),
    );
    expect(context?.workflow).not.toHaveProperty('current_stage');
    expect(context?.board.stages).toEqual([
      expect.objectContaining({
        name: 'triage',
        status: 'active',
        is_active: true,
        open_work_item_count: 2,
        total_work_item_count: 2,
      }),
      expect.objectContaining({
        name: 'review',
        status: 'awaiting_gate',
        is_active: true,
        gate_status: 'awaiting_approval',
        open_work_item_count: 0,
        total_work_item_count: 0,
      }),
    ]);
    expect(context?.activation).toEqual(
      expect.objectContaining({
        dispatch_attempt: 2,
        dispatch_token: 'dispatch-token-1',
      }),
    );
    expect(context?.board.work_items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'wi-1',
          stage_name: 'implementation',
          next_expected_actor: 'reviewer',
          next_expected_action: 'review',
          rework_count: 1,
        }),
      ]),
    );
    expect(context?.board.work_items[0]).not.toHaveProperty('current_checkpoint');
  });
});
