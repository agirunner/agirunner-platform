import { describe, expect, it, vi } from 'vitest';

import { buildOrchestratorTaskContext } from '../../src/services/orchestrator-task-context.js';

describe('buildOrchestratorTaskContext', () => {
  it('derives active stages from open work items and gate posture for continuous workflows', async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM workflows w')) {
          return {
            rows: [{
              id: 'workflow-1',
              name: 'Workflow One',
              lifecycle: 'continuous',
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
                lifecycle: 'continuous',
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
              { id: 'stage-1', name: 'triage', gate_status: 'not_requested' },
              { id: 'stage-2', name: 'review', gate_status: 'awaiting_approval' },
            ],
          };
        }
        if (sql.includes('FROM workflow_work_items')) {
          return {
            rows: [
              { id: 'wi-1', stage_name: 'implementation', completed_at: null },
              { id: 'wi-2', stage_name: 'triage', completed_at: null },
              { id: 'wi-3', stage_name: 'triage', completed_at: null },
              { id: 'wi-4', stage_name: 'done', completed_at: '2026-03-11T00:00:00.000Z' },
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
        lifecycle: 'continuous',
        active_stages: ['triage', 'implementation', 'review'],
      }),
    );
    expect(context?.workflow).not.toHaveProperty('current_stage');
    expect(context?.activation).toEqual(
      expect.objectContaining({
        dispatch_attempt: 2,
        dispatch_token: 'dispatch-token-1',
      }),
    );
  });
});
