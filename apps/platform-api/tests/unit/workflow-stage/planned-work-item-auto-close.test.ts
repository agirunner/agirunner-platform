import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/services/workflow-stage/workflow-stage-reconciliation.js', () => ({
  reconcilePlannedWorkflowStages: vi.fn(async () => undefined),
}));

import { maybeAutoCloseCompletedPlannedPredecessorWorkItem } from '../../../src/services/workflow-stage/planned-work-item-auto-close.js';
import { reconcilePlannedWorkflowStages } from '../../../src/services/workflow-stage/workflow-stage-reconciliation.js';

describe('maybeAutoCloseCompletedPlannedPredecessorWorkItem', () => {
  const identity = {
    tenantId: 'tenant-1',
    scope: 'agent',
    keyPrefix: 'agent-key',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('auto-closes a final planned-stage work item when closure is already legal', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT w.lifecycle, p.definition')) {
          return {
            rowCount: 1,
            rows: [{
              lifecycle: 'planned',
              definition: {
                process_instructions: 'Close work when the current stage is satisfied.',
                roles: ['approve-release-coordinator'],
                stages: [
                  { name: 'blueprint', goal: 'Blueprint is ready.' },
                  { name: 'implementation', goal: 'Implementation is ready.' },
                  { name: 'release-readiness', goal: 'Release package is ready.' },
                ],
                board: {
                  entry_column_id: 'active',
                  columns: [
                    { id: 'active', label: 'Active' },
                    { id: 'done', label: 'Done', is_terminal: true },
                  ],
                },
              },
            }],
          };
        }
        if (sql.includes('SELECT wi.stage_name') && sql.includes('JOIN workflow_stages ws')) {
          return {
            rowCount: 1,
            rows: [{
              stage_name: 'release-readiness',
              column_id: 'active',
              completed_at: null,
              gate_status: 'not_requested',
              blocked_state: null,
              escalation_status: null,
              next_expected_actor: null,
              next_expected_action: null,
            }],
          };
        }
        if (sql.includes('SELECT th.completion_callouts')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'work-item-1']);
          return {
            rowCount: 1,
            rows: [{
              completion_callouts: {
                residual_risks: [{ code: 'schema-drift', summary: 'Legacy doc names differ from the current contract.' }],
              },
            }],
          };
        }
        if (sql.includes('SELECT latest_assessment.resolution AS blocking_resolution')) {
          return {
            rowCount: 0,
            rows: [],
          };
        }
        if (sql.includes('SELECT COUNT(*)::int AS count')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'work-item-1']);
          return {
            rowCount: 1,
            rows: [{ count: 0 }],
          };
        }
        if (sql.includes('UPDATE workflow_work_items')) {
          expect(sql).toContain('completion_callouts = $6::jsonb');
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'work-item-1',
            'done',
            expect.any(Date),
            {
              residual_risks: [{ code: 'schema-drift', summary: 'Legacy doc names differ from the current contract.' }],
            },
          ]);
          return {
            rowCount: 1,
            rows: [{ id: 'work-item-1' }],
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };
    const eventService = {
      emit: vi.fn(async () => undefined),
    };

    const closed = await maybeAutoCloseCompletedPlannedPredecessorWorkItem(
      eventService as never,
      identity as never,
      'workflow-1',
      'work-item-1',
      client as never,
    );

    expect(closed).toBe(true);
    expect(eventService.emit).toHaveBeenCalledTimes(3);
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'work_item.completed',
        entityId: 'work-item-1',
        data: expect.objectContaining({
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          stage_name: 'release-readiness',
          column_id: 'done',
        }),
      }),
      client,
    );
    expect(reconcilePlannedWorkflowStages).toHaveBeenCalledWith(client, 'tenant-1', 'workflow-1');
  });

  it('does not auto-close when the work item still has required continuation pending', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('SELECT w.lifecycle, p.definition')) {
          return {
            rowCount: 1,
            rows: [{
              lifecycle: 'planned',
              definition: {
                process_instructions: 'Keep the work item open while required continuation remains.',
                roles: ['approve-release-coordinator'],
                stages: [{ name: 'release-readiness', goal: 'Release package is ready.' }],
                board: {
                  entry_column_id: 'active',
                  columns: [
                    { id: 'active', label: 'Active' },
                    { id: 'done', label: 'Done', is_terminal: true },
                  ],
                },
              },
            }],
          };
        }
        if (sql.includes('SELECT wi.stage_name') && sql.includes('JOIN workflow_stages ws')) {
          return {
            rowCount: 1,
            rows: [{
              stage_name: 'release-readiness',
              column_id: 'active',
              completed_at: null,
              gate_status: 'not_requested',
              blocked_state: null,
              escalation_status: null,
              next_expected_actor: 'approve-release-coordinator',
              next_expected_action: 'handoff',
            }],
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };
    const eventService = {
      emit: vi.fn(async () => undefined),
    };

    const closed = await maybeAutoCloseCompletedPlannedPredecessorWorkItem(
      eventService as never,
      identity as never,
      'workflow-1',
      'work-item-1',
      client as never,
    );

    expect(closed).toBe(false);
    expect(eventService.emit).not.toHaveBeenCalled();
    expect(reconcilePlannedWorkflowStages).not.toHaveBeenCalled();
  });
});
