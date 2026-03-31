import { describe, expect, it, vi } from 'vitest';

import { createWorkspaceTimelineService } from './support.js';

describe('WorkspaceTimelineService', () => {
  it('rejects terminal-state recording for non-playbook workflows', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rowCount: 1,
        rows: [
          {
            id: 'workflow-1',
            workspace_id: 'workspace-1',
            playbook_id: null,
            metadata: {},
          },
        ],
      }),
    };
    const service = createWorkspaceTimelineService(pool.query);

    await expect(service.recordWorkflowTerminalState('tenant-1', 'workflow-1')).rejects.toThrow(
      'only support playbook workflows',
    );
  });

  it('hydrates playbook workspace timelines from live activation, work-item, and gate rows', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM workflows')) {
        return {
          rowCount: 2,
          rows: [
            {
              id: 'workflow-1',
              name: 'Playbook Workflow',
              state: 'active',
              lifecycle: 'planned',
              playbook_id: 'playbook-1',
              started_at: '2026-03-11T00:05:00.000Z',
              completed_at: null,
              created_at: '2026-03-11T00:00:00.000Z',
              metadata: {
                run_summary: {
                  workflow_id: 'workflow-1',
                  kind: 'run_summary',
                  legacy_only: true,
                  phase_summary: { current_phase: 'build' },
                },
              },
            },
            {
              id: 'workflow-2',
              name: 'Legacy Workflow',
              state: 'completed',
              lifecycle: 'planned',
              playbook_id: null,
              started_at: null,
              completed_at: null,
              created_at: '2026-03-11T00:00:00.000Z',
              metadata: {},
            },
          ],
        };
      }
      if (sql.includes('FROM tasks')) {
        return {
          rowCount: 1,
          rows: [
            {
              id: 'task-1',
              workflow_id: 'workflow-1',
              state: 'completed',
              stage_name: 'review',
              work_item_id: 'wi-1',
              rework_count: 0,
              metrics: { total_cost_usd: 2.25 },
            },
          ],
        };
      }
      if (sql.includes('FROM workflow_artifacts')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('FROM events')) {
        return {
          rowCount: 3,
          rows: [
            {
              workflow_id: 'workflow-1',
              type: 'workflow.activation_started',
              actor_type: 'system',
              actor_id: 'dispatcher',
              data: {
                workflow_id: 'workflow-1',
                activation_id: 'activation-1',
                event_type: 'work_item.created',
                reason: 'queued_events',
              },
              created_at: '2026-03-11T00:06:00.000Z',
            },
            {
              workflow_id: 'workflow-1',
              type: 'work_item.created',
              actor_type: 'agent',
              actor_id: 'orchestrator',
              data: {
                workflow_id: 'workflow-1',
                work_item_id: 'wi-1',
                stage_name: 'review',
              },
              created_at: '2026-03-11T00:06:15.000Z',
            },
            {
              workflow_id: 'workflow-1',
              type: 'stage.gate_requested',
              actor_type: 'agent',
              actor_id: 'orchestrator',
              data: {
                workflow_id: 'workflow-1',
                stage_name: 'review',
                recommendation: 'approve',
              },
              created_at: '2026-03-11T00:07:00.000Z',
            },
          ],
        };
      }
      if (sql.includes('FROM workflow_stages')) {
        return {
          rowCount: 1,
          rows: [
            {
              workflow_id: 'workflow-1',
              name: 'review',
              goal: 'Review the delivery',
              human_gate: true,
              status: 'awaiting_gate',
              gate_status: 'awaiting_approval',
              iteration_count: 0,
              summary: null,
              started_at: '2026-03-11T00:06:00.000Z',
              completed_at: null,
            },
          ],
        };
      }
      if (sql.includes('FROM workflow_work_items')) {
        return {
          rowCount: 1,
          rows: [
            {
              workflow_id: 'workflow-1',
              id: 'wi-1',
              stage_name: 'review',
              column_id: 'review',
              title: 'Review the release candidate',
              completed_at: null,
            },
          ],
        };
      }
      if (sql.includes('FROM workflow_activations')) {
        return {
          rowCount: 1,
          rows: [
            {
              workflow_id: 'workflow-1',
              activation_id: 'activation-1',
              state: 'processing',
              reason: 'work_item.created',
              event_type: 'work_item.created',
              task_id: null,
              queued_at: '2026-03-11T00:05:45.000Z',
              started_at: '2026-03-11T00:06:00.000Z',
              consumed_at: null,
              completed_at: null,
              error: null,
            },
          ],
        };
      }
      if (sql.includes('FROM workflow_stage_gates')) {
        return {
          rowCount: 1,
          rows: [
            {
              workflow_id: 'workflow-1',
              id: 'gate-1',
              stage_name: 'review',
              status: 'awaiting_approval',
              request_summary: 'Ready for review',
              recommendation: 'approve',
              concerns: [],
              key_artifacts: [],
              requested_by_type: 'agent',
              requested_by_id: 'orchestrator',
              requested_at: '2026-03-11T00:07:00.000Z',
              decision_feedback: null,
              decided_by_type: null,
              decided_by_id: null,
              decided_at: null,
            },
          ],
        };
      }
      return { rowCount: 0, rows: [] };
    });
    const service = createWorkspaceTimelineService(query);

    const result = await service.getWorkspaceTimeline('tenant-1', 'workspace-1');

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(
      expect.objectContaining({
        workflow_id: 'workflow-1',
        kind: 'run_summary',
        activation_activity: expect.objectContaining({
          total_events: 1,
          latest_activation_id: 'activation-1',
        }),
        work_item_activity: expect.objectContaining({
          total: 1,
          created_event_count: 1,
        }),
        gate_activity: expect.objectContaining({
          requested_count: 1,
          open_gate_count: 1,
        }),
      }),
    );
  });

  it('ignores legacy timeline_summary-only metadata when loading workspace timelines', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rowCount: 1,
        rows: [
          {
            id: 'workflow-legacy',
            name: 'Legacy Workflow',
            state: 'completed',
            started_at: null,
            completed_at: null,
            created_at: '2026-03-11T00:00:00.000Z',
            metadata: {
              timeline_summary: { workflow_id: 'workflow-legacy', kind: 'run_summary' },
            },
          },
        ],
      }),
    };
    const service = createWorkspaceTimelineService(pool.query);

    const result = await service.getWorkspaceTimeline('tenant-1', 'workspace-1');

    expect(result).toEqual([]);
  });
});
