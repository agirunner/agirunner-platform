import { describe, expect, it, vi } from 'vitest';

import { ProjectTimelineService } from '../../src/services/project-timeline-service.js';

describe('ProjectTimelineService', () => {
  it('rejects terminal-state recording for non-playbook workflows', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rowCount: 1,
        rows: [
          {
            id: 'workflow-1',
            project_id: 'project-1',
            playbook_id: null,
            metadata: {},
          },
        ],
      }),
    };
    const service = new ProjectTimelineService(pool as never);

    await expect(service.recordWorkflowTerminalState('tenant-1', 'workflow-1')).rejects.toThrow(
      'only support playbook workflows',
    );
    expect(String(pool.query.mock.calls[0]?.[0] ?? '')).not.toContain('SELECT * FROM workflows');
    expect(String(pool.query.mock.calls[0]?.[0] ?? '')).not.toContain('template_id');
  });

  it('hydrates playbook project timelines from live activation, work-item, and gate rows', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM workflows')) {
        return {
          rowCount: 2,
          rows: [
            {
              id: 'workflow-1',
              name: 'Playbook Workflow',
              state: 'active',
              lifecycle: 'standard',
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
              lifecycle: 'standard',
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
    const service = new ProjectTimelineService({ query } as never);

    const result = await service.getProjectTimeline('tenant-1', 'project-1');

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
    expect(result[0]).not.toHaveProperty('legacy_only');
    expect(result[0]).not.toHaveProperty('phase_summary');
  });

  it('ignores legacy timeline_summary-only metadata when loading project timelines', async () => {
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
    const service = new ProjectTimelineService(pool as never);

    const result = await service.getProjectTimeline('tenant-1', 'project-1');

    expect(result).toEqual([]);
  });

  it('includes activation, escalation, child workflow, and gate activity in terminal workflow summaries', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM workflows')) {
        return {
          rowCount: 1,
          rows: [
            {
              id: 'workflow-1',
              name: 'Release flow',
              state: 'completed',
              lifecycle: 'standard',
              playbook_id: 'playbook-1',
              project_id: 'project-1',
              metadata: {},
              created_at: '2026-03-10T00:00:00.000Z',
              started_at: '2026-03-10T00:10:00.000Z',
              completed_at: '2026-03-10T01:00:00.000Z',
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
              rework_count: 1,
              metrics: { total_cost_usd: 1.5 },
            },
          ],
        };
      }
      if (sql.includes('FROM workflow_artifacts')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('FROM events')) {
        expect(sql).toContain("COALESCE(e.data->>'parent_workflow_id', '') = ANY($2::text[])");
        expect(sql).toContain("COALESCE(e.data->>'workflow_id', '') = ANY($2::text[])");
        return {
          rowCount: 7,
          rows: [
            {
              workflow_id: 'workflow-1',
              type: 'workflow.activation_queued',
              actor_type: 'system',
              actor_id: 'dispatcher',
              data: {
                workflow_id: 'workflow-1',
                activation_id: 'activation-1',
                event_type: 'task.agent_escalated',
                reason: 'task.agent_escalated',
                task_id: 'task-1',
                event_count: 1,
              },
              created_at: '2026-03-10T00:48:00.000Z',
            },
            {
              workflow_id: 'workflow-1',
              type: 'task.agent_escalated',
              actor_type: 'agent',
              actor_id: 'agent-1',
              data: {
                task_id: 'task-1',
                source_task_id: 'task-1',
                workflow_id: 'workflow-1',
                stage_name: 'review',
                work_item_id: 'wi-1',
                target_role: 'human',
              },
              created_at: '2026-03-10T00:49:00.000Z',
            },
            {
              workflow_id: 'workflow-1',
              type: 'workflow.activation_queued',
              actor_type: 'system',
              actor_id: 'dispatcher',
              data: {
                workflow_id: 'workflow-1',
                activation_id: 'activation-2',
                event_type: 'child_workflow.completed',
                reason: 'child_workflow.completed',
                child_workflow_id: 'workflow-child-1',
                child_workflow_state: 'completed',
                parent_stage_name: 'review',
                parent_work_item_id: 'wi-1',
                outcome: { state: 'completed', task_count: 2, failed_task_count: 0 },
              },
              created_at: '2026-03-10T00:49:30.000Z',
            },
            {
              workflow_id: 'workflow-1',
              type: 'child_workflow.failed',
              actor_type: 'system',
              actor_id: 'workflow_state_deriver',
              data: {
                parent_workflow_id: 'workflow-1',
                child_workflow_id: 'workflow-child-2',
                child_workflow_state: 'failed',
                outcome: { state: 'failed', task_count: 1, failed_task_count: 1 },
              },
              created_at: '2026-03-10T00:49:45.000Z',
            },
            {
              workflow_id: 'workflow-1',
              type: 'stage.gate_requested',
              actor_type: 'agent',
              actor_id: 'agent-1',
              data: { workflow_id: 'workflow-1', stage_name: 'review', recommendation: 'approve' },
              created_at: '2026-03-10T00:50:00.000Z',
            },
            {
              workflow_id: 'workflow-1',
              type: 'workflow.activation_stale_detected',
              actor_type: 'system',
              actor_id: 'dispatcher',
              data: {
                workflow_id: 'workflow-1',
                activation_id: 'activation-2',
                event_type: 'child_workflow.completed',
                reason: 'orchestrator task heartbeat expired',
              },
              created_at: '2026-03-10T00:54:00.000Z',
            },
            {
              workflow_id: 'workflow-1',
              type: 'stage.gate.approve',
              actor_type: 'admin',
              actor_id: 'admin-1',
              data: { workflow_id: 'workflow-1', stage_name: 'review', feedback: 'Looks good' },
              created_at: '2026-03-10T00:55:00.000Z',
            },
            {
              workflow_id: 'workflow-1',
              type: 'work_item.updated',
              actor_type: 'system',
              actor_id: 'orchestrator',
              data: {
                workflow_id: 'workflow-1',
                work_item_id: 'wi-1',
                stage_name: 'review',
              },
              created_at: '2026-03-10T00:56:00.000Z',
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
              goal: 'Validate release readiness',
              human_gate: true,
              status: 'completed',
              gate_status: 'approved',
              iteration_count: 1,
              summary: 'Approved for release',
              started_at: '2026-03-10T00:45:00.000Z',
              completed_at: '2026-03-10T00:56:00.000Z',
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
              column_id: 'done',
              title: 'Review release',
              completed_at: '2026-03-10T00:56:00.000Z',
            },
          ],
        };
      }
      if (sql.includes('FROM workflow_activations')) {
        return {
          rowCount: 2,
          rows: [
            {
              workflow_id: 'workflow-1',
              activation_id: 'activation-1',
              state: 'processing',
              reason: 'task.agent_escalated',
              event_type: 'task.agent_escalated',
              task_id: 'task-1',
              queued_at: '2026-03-10T00:48:00.000Z',
              started_at: '2026-03-10T00:48:30.000Z',
              consumed_at: null,
              completed_at: null,
              error: null,
            },
            {
              workflow_id: 'workflow-1',
              activation_id: 'activation-2',
              state: 'completed',
              reason: 'child_workflow.completed',
              event_type: 'child_workflow.completed',
              task_id: null,
              queued_at: '2026-03-10T00:49:30.000Z',
              started_at: '2026-03-10T00:49:45.000Z',
              consumed_at: '2026-03-10T00:54:00.000Z',
              completed_at: '2026-03-10T00:54:00.000Z',
              error: {
                recovery: {
                  status: 'stale_detected',
                },
              },
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
              status: 'approved',
              request_summary: 'Ready for review',
              recommendation: 'approve',
              concerns: [],
              key_artifacts: [],
              requested_by_type: 'agent',
              requested_by_id: 'agent-1',
              requested_at: '2026-03-10T00:50:00.000Z',
              decision_feedback: 'Looks good',
              decided_by_type: 'admin',
              decided_by_id: 'admin-1',
              decided_at: '2026-03-10T00:55:00.000Z',
            },
          ],
        };
      }
      if (sql.includes('SELECT memory FROM projects')) {
        return { rowCount: 1, rows: [{ memory: {} }] };
      }
      return { rowCount: 0, rows: [] };
    });
    const service = new ProjectTimelineService({ query } as never);

    const summary = await service.recordWorkflowTerminalState('tenant-1', 'workflow-1');

    expect(summary).not.toBeNull();
    const persistedSummary = summary as Record<string, unknown>;
    expect(persistedSummary).toEqual(
      expect.objectContaining({
        workflow_id: 'workflow-1',
        activation_activity: expect.objectContaining({
          queued_count: 0,
          started_count: 2,
          stale_detected_count: 1,
          batches: expect.arrayContaining([
            expect.objectContaining({ activation_id: 'activation-1' }),
            expect.objectContaining({ activation_id: 'activation-2' }),
          ]),
        }),
        work_item_activity: expect.objectContaining({
          updated_event_count: 1,
        }),
        escalation_activity: expect.objectContaining({
          escalated_count: 1,
        }),
        child_workflow_activity: expect.objectContaining({
          completion_event_count: 1,
          failure_event_count: 1,
          transitions: [
            expect.objectContaining({
              child_workflow_id: 'workflow-child-1',
              child_workflow_state: 'completed',
            }),
            expect.objectContaining({
              child_workflow_id: 'workflow-child-2',
              child_workflow_state: 'failed',
            }),
          ],
        }),
        orchestrator_analytics: expect.objectContaining({
          activation_count: 2,
          stale_detection_count: 1,
          total_cost_usd: 1.5,
          reworked_task_count: 1,
        }),
        stage_metrics: [
          expect.objectContaining({
            name: 'review',
            gate_history: [
              expect.objectContaining({ action: 'requested', recommendation: 'approve' }),
              expect.objectContaining({ action: 'approve', feedback: 'Looks good' }),
            ],
          }),
        ],
      }),
    );
    expect(persistedSummary).not.toHaveProperty('task_counts');
    expect(
      (persistedSummary.stage_metrics as Array<Record<string, unknown>>)[0],
    ).not.toHaveProperty('task_counts');
    const workflowUpdateCall = query.mock.calls.find((call) =>
      String(call[0]).includes('UPDATE workflows'),
    ) as [string, unknown[]] | undefined;
    expect(workflowUpdateCall?.[1]?.[2]).toEqual({
      run_summary: expect.objectContaining({ workflow_id: 'workflow-1' }),
    });
    const projectUpdateCall = query.mock.calls.find((call) =>
      String(call[0]).includes('UPDATE projects'),
    ) as [string, unknown[]] | undefined;
    expect(projectUpdateCall?.[1]?.[2]).toEqual(
      expect.objectContaining({
        project_timeline: expect.any(Array),
        last_run_summary: expect.objectContaining({ workflow_id: 'workflow-1' }),
      }),
    );
    expect(projectUpdateCall?.[1]?.[2]).not.toHaveProperty('last_workflow_summary');
    expect(projectUpdateCall?.[1]?.[2]).not.toHaveProperty('run_summaries');
    const eventCall = query.mock.calls.find((call) => String(call[0]).includes('FROM events')) as
      | [string, unknown[]]
      | undefined;
    expect(eventCall?.[1]).toEqual([
      'tenant-1',
      ['workflow-1'],
      [
        'stage.started',
        'stage.completed',
        'workflow.activation_queued',
        'workflow.activation_started',
        'workflow.activation_completed',
        'workflow.activation_failed',
        'workflow.activation_requeued',
        'workflow.activation_stale_detected',
      ],
      ['child_workflow.completed', 'child_workflow.failed', 'child_workflow.cancelled'],
      [
        'stage.gate_requested',
        'stage.gate.approve',
        'stage.gate.reject',
        'stage.gate.request_changes',
      ],
      ['workflow-1'],
      [
        'task.agent_escalated',
        'task.escalation_task_created',
        'task.escalation_response_recorded',
        'task.escalation_resolved',
        'task.escalation_depth_exceeded',
      ],
      ['work_item.created', 'work_item.updated'],
    ]);
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
              lifecycle: 'standard',
              playbook_id: 'playbook-2',
              project_id: 'project-1',
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
      if (sql.includes('SELECT memory FROM projects')) {
        return { rowCount: 1, rows: [{ memory: {} }] };
      }
      return { rowCount: 0, rows: [] };
    });
    const service = new ProjectTimelineService({ query } as never);

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
              lifecycle: 'continuous',
              playbook_id: 'playbook-3',
              project_id: 'project-1',
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
      if (sql.includes('SELECT memory FROM projects')) {
        return { rowCount: 1, rows: [{ memory: {} }] };
      }
      return { rowCount: 0, rows: [] };
    });
    const service = new ProjectTimelineService({ query } as never);

    const summary = await service.recordWorkflowTerminalState('tenant-1', 'workflow-3');

    expect(summary).toEqual(
      expect.objectContaining({
        lifecycle: 'continuous',
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
