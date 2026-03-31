import { describe, expect, it, vi } from 'vitest';

import { createWorkspaceTimelineService } from './support.js';

describe('WorkspaceTimelineService', () => {
  it('redacts secret-bearing values before persisting workflow run summaries', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM workflows')) {
        return {
          rowCount: 1,
          rows: [
            {
              id: 'workflow-secret',
              name: 'Secret Workflow',
              state: 'completed',
              lifecycle: 'planned',
              playbook_id: 'playbook-1',
              workspace_id: 'workspace-1',
              metadata: {},
              created_at: '2026-03-10T00:00:00.000Z',
              started_at: '2026-03-10T00:05:00.000Z',
              completed_at: '2026-03-10T00:25:00.000Z',
            },
          ],
        };
      }
      if (sql.includes('FROM tasks')) {
        return {
          rowCount: 1,
          rows: [
            {
              id: 'task-secret',
              workflow_id: 'workflow-secret',
              state: 'completed',
              stage_name: 'review',
              work_item_id: 'wi-secret',
              rework_count: 0,
              metrics: { total_cost_usd: 1.25 },
              git_info: {
                linked_prs: [
                  {
                    url: 'https://github.com/agisnap/agirunner-test-fixtures/pull/2',
                    token: 'secret:PR_SECRET',
                  },
                ],
              },
            },
          ],
        };
      }
      if (sql.includes('FROM workflow_artifacts')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('FROM events')) {
        return {
          rowCount: 1,
          rows: [
            {
              workflow_id: 'workflow-secret',
              type: 'child_workflow.completed',
              actor_type: 'system',
              actor_id: 'dispatcher',
              data: {
                parent_workflow_id: 'workflow-secret',
                child_workflow_id: 'workflow-child',
                child_workflow_state: 'completed',
                outcome: {
                  authorization: 'Bearer child-secret',
                },
              },
              created_at: '2026-03-10T00:15:00.000Z',
            },
          ],
        };
      }
      if (sql.includes('FROM workflow_stages')) {
        return {
          rowCount: 1,
          rows: [
            {
              workflow_id: 'workflow-secret',
              name: 'review',
              goal: 'Review work',
              human_gate: true,
              status: 'completed',
              gate_status: 'approved',
              iteration_count: 0,
              summary: 'secret:STAGE_SECRET',
              started_at: '2026-03-10T00:05:00.000Z',
              completed_at: '2026-03-10T00:25:00.000Z',
            },
          ],
        };
      }
      if (sql.includes('FROM workflow_work_items')) {
        return {
          rowCount: 1,
          rows: [
            {
              workflow_id: 'workflow-secret',
              id: 'wi-secret',
              stage_name: 'review',
              column_id: 'done',
              title: 'Review work item',
              completed_at: '2026-03-10T00:24:00.000Z',
            },
          ],
        };
      }
      if (sql.includes('FROM workflow_activations')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('FROM workflow_stage_gates')) {
        return {
          rowCount: 1,
          rows: [
            {
              workflow_id: 'workflow-secret',
              id: 'gate-secret',
              stage_name: 'review',
              status: 'approved',
              request_summary: 'secret:GATE_SECRET',
              recommendation: 'approve',
              concerns: [{ access_token: 'secret:CONCERN_SECRET' }],
              key_artifacts: [{ note: 'secret:ARTIFACT_SECRET' }],
              requested_by_type: 'agent',
              requested_by_id: 'orchestrator',
              requested_at: '2026-03-10T00:10:00.000Z',
              decision_feedback: 'Bearer decision-secret',
              decided_by_type: 'admin',
              decided_by_id: 'admin-1',
              decided_at: '2026-03-10T00:18:00.000Z',
            },
          ],
        };
      }
      if (sql.includes('SELECT memory FROM workspaces')) {
        return {
          rowCount: 1,
          rows: [{ memory: {} }],
        };
      }
      if (sql.includes('UPDATE workflows')) {
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('UPDATE workspaces')) {
        return { rowCount: 1, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    });
    const service = createWorkspaceTimelineService(query);

    const result = await service.recordWorkflowTerminalState('tenant-1', 'workflow-secret');

    expect(result).toEqual(
      expect.objectContaining({
        workflow_id: 'workflow-secret',
      }),
    );
    expect((result as Record<string, any>).stage_metrics[0].summary).toBe(
      'redacted://workflow-summary-secret',
    );
    expect((result as Record<string, any>).stage_metrics[0].gate_history[0].feedback).toBe(
      'redacted://workflow-summary-secret',
    );
    expect((result as Record<string, any>).stage_metrics[0].gate_history[1].feedback).toBe(
      'redacted://workflow-summary-secret',
    );
    expect((result as Record<string, any>).child_workflow_activity.transitions[0].outcome.authorization).toBe(
      'redacted://workflow-summary-secret',
    );
    expect((result as Record<string, any>).produced_artifacts[0].reference.token).toBe(
      'redacted://workflow-summary-secret',
    );

    const workflowUpdateCall = query.mock.calls.find((call) =>
      String(call[0]).includes('UPDATE workflows'),
    ) as [string, unknown[]] | undefined;
    const persistedSummary = (workflowUpdateCall?.[1]?.[2] as Record<string, any>).run_summary;
    expect(persistedSummary.stage_metrics[0].summary).toBe('redacted://workflow-summary-secret');
    expect(persistedSummary.stage_metrics[0].gate_history[0].feedback).toBe(
      'redacted://workflow-summary-secret',
    );
    expect(persistedSummary.child_workflow_activity.transitions[0].outcome.authorization).toBe(
      'redacted://workflow-summary-secret',
    );
    expect(persistedSummary.produced_artifacts[0].reference.token).toBe(
      'redacted://workflow-summary-secret',
    );

    const workspaceUpdateCall = query.mock.calls.find((call) =>
      String(call[0]).includes('UPDATE workspaces'),
    ) as [string, unknown[]] | undefined;
    const persistedWorkspaceMemory = workspaceUpdateCall?.[1]?.[2] as Record<string, any>;
    expect(persistedWorkspaceMemory.last_run_summary.stage_metrics[0].summary).toBe(
      'redacted://workflow-summary-secret',
    );
    expect(persistedWorkspaceMemory.workspace_timeline[0].child_workflow_activity.transitions[0].outcome.authorization).toBe(
      'redacted://workflow-summary-secret',
    );
  });

  it('persists only activation, stage, gate, work-item, and escalation signals in summaries', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM workflows')) {
        return {
          rowCount: 1,
          rows: [
            {
              id: 'workflow-2',
              name: 'Modern flow',
              state: 'completed',
              lifecycle: 'planned',
              playbook_id: 'playbook-2',
              workspace_id: 'workspace-1',
              metadata: {},
              created_at: '2026-03-10T00:00:00.000Z',
              started_at: '2026-03-10T00:10:00.000Z',
              completed_at: '2026-03-10T00:20:00.000Z',
            },
          ],
        };
      }
      if (sql.includes('FROM tasks')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('FROM workflow_artifacts')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('FROM events')) {
        return {
          rowCount: 2,
          rows: [
            {
              workflow_id: 'workflow-2',
              type: 'workflow.activation_completed',
              actor_type: 'system',
              actor_id: 'dispatcher',
              data: {
                workflow_id: 'workflow-2',
                activation_id: 'activation-1',
                event_type: 'work_item.created',
                reason: 'queued_events',
                event_count: 1,
              },
              created_at: '2026-03-10T00:12:00.000Z',
            },
            {
              workflow_id: 'workflow-2',
              type: 'stage.gate_requested',
              actor_type: 'agent',
              actor_id: 'agent-1',
              data: { workflow_id: 'workflow-2', stage_name: 'review', recommendation: 'approve' },
              created_at: '2026-03-10T00:13:00.000Z',
            },
          ],
        };
      }
      if (sql.includes('FROM workflow_stages')) {
        return {
          rowCount: 1,
          rows: [
            {
              workflow_id: 'workflow-2',
              name: 'review',
              goal: 'Review work',
              human_gate: true,
              status: 'awaiting_gate',
              gate_status: 'awaiting_approval',
              iteration_count: 0,
              summary: null,
              started_at: '2026-03-10T00:10:00.000Z',
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
              workflow_id: 'workflow-2',
              id: 'wi-2',
              stage_name: 'review',
              column_id: 'review',
              title: 'Review item',
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
              workflow_id: 'workflow-2',
              activation_id: 'activation-1',
              state: 'completed',
              reason: 'work_item.created',
              event_type: 'work_item.created',
              task_id: null,
              queued_at: '2026-03-10T00:12:00.000Z',
              started_at: '2026-03-10T00:12:05.000Z',
              consumed_at: '2026-03-10T00:12:10.000Z',
              completed_at: '2026-03-10T00:12:10.000Z',
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
              workflow_id: 'workflow-2',
              id: 'gate-2',
              stage_name: 'review',
              status: 'awaiting_approval',
              request_summary: 'Ready for signoff',
              recommendation: 'approve',
              concerns: [],
              key_artifacts: [],
              requested_by_type: 'agent',
              requested_by_id: 'agent-1',
              requested_at: '2026-03-10T00:13:00.000Z',
              decision_feedback: null,
              decided_by_type: null,
              decided_by_id: null,
              decided_at: null,
            },
          ],
        };
      }
      if (sql.includes('SELECT memory FROM workspaces')) {
        return { rowCount: 1, rows: [{ memory: {} }] };
      }
      return { rowCount: 0, rows: [] };
    });
    const service = createWorkspaceTimelineService(query);

    const summary = await service.recordWorkflowTerminalState('tenant-1', 'workflow-2');

    expect(summary).not.toBeNull();
    const modernSummary = summary as Record<string, unknown>;
    expect(modernSummary).toEqual(
      expect.objectContaining({
        workflow_id: 'workflow-2',
        activation_activity: expect.objectContaining({
          total_events: 1,
          completed_count: 1,
        }),
        gate_activity: expect.objectContaining({
          requested_count: 1,
        }),
        work_item_activity: expect.objectContaining({
          total: 1,
          open: 1,
          completed: 0,
        }),
      }),
    );
    expect(modernSummary).not.toHaveProperty('task_counts');
    expect((modernSummary.stage_metrics as Array<Record<string, unknown>>)[0]).not.toHaveProperty(
      'task_counts',
    );
  });

  it('normalizes continuous stage status from work-item and gate posture before persisting terminal summaries', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM workflows')) {
        return {
          rowCount: 1,
          rows: [
            {
              id: 'workflow-3',
              name: 'Continuous flow',
              state: 'active',
              lifecycle: 'ongoing',
              playbook_id: 'playbook-3',
              workspace_id: 'workspace-1',
              metadata: {},
              created_at: '2026-03-10T00:00:00.000Z',
              started_at: '2026-03-10T00:10:00.000Z',
              completed_at: null,
            },
          ],
        };
      }
      if (sql.includes('FROM tasks')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('FROM workflow_artifacts')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('FROM events')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('FROM workflow_stages')) {
        return {
          rowCount: 3,
          rows: [
            {
              workflow_id: 'workflow-3',
              name: 'triage',
              goal: 'Sort',
              human_gate: false,
              status: 'pending',
              gate_status: 'not_requested',
              iteration_count: 0,
              summary: null,
              started_at: null,
              completed_at: null,
            },
            {
              workflow_id: 'workflow-3',
              name: 'review',
              goal: 'Review',
              human_gate: true,
              status: 'pending',
              gate_status: 'awaiting_approval',
              iteration_count: 0,
              summary: null,
              started_at: null,
              completed_at: null,
            },
            {
              workflow_id: 'workflow-3',
              name: 'done',
              goal: 'Done',
              human_gate: false,
              status: 'pending',
              gate_status: 'not_requested',
              iteration_count: 0,
              summary: null,
              started_at: null,
              completed_at: null,
            },
          ],
        };
      }
      if (sql.includes('FROM workflow_work_items')) {
        return {
          rowCount: 2,
          rows: [
            {
              workflow_id: 'workflow-3',
              id: 'wi-1',
              stage_name: 'triage',
              column_id: 'todo',
              title: 'Sort intake',
              completed_at: null,
            },
            {
              workflow_id: 'workflow-3',
              id: 'wi-2',
              stage_name: 'done',
              column_id: 'done',
              title: 'Finished item',
              completed_at: '2026-03-10T00:20:00.000Z',
            },
          ],
        };
      }
      if (sql.includes('FROM workflow_activations')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('FROM workflow_stage_gates')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('SELECT memory FROM workspaces')) {
        return { rowCount: 1, rows: [{ memory: {} }] };
      }
      return { rowCount: 0, rows: [] };
    });
    const service = createWorkspaceTimelineService(query);

    const summary = await service.recordWorkflowTerminalState('tenant-1', 'workflow-3');

    expect(summary).toEqual(
      expect.objectContaining({
        lifecycle: 'ongoing',
        work_item_activity: expect.objectContaining({
          active_stage_names: ['triage', 'review'],
        }),
        stage_activity: [
          expect.objectContaining({ name: 'triage', status: 'active' }),
          expect.objectContaining({ name: 'review', status: 'awaiting_gate' }),
          expect.objectContaining({ name: 'done', status: 'completed' }),
        ],
      }),
    );
  });
});
