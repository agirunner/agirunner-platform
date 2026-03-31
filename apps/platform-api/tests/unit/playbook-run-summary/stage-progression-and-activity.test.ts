import { describe, expect, it } from 'vitest';

import { buildPlaybookRunSummary } from '../../../src/services/playbook-run-summary.js';

describe('buildPlaybookRunSummary', () => {
  it('builds stage-based progression and metrics for playbook workflows', () => {
    const summary = buildPlaybookRunSummary({
      workflow: {
        id: 'wf-1',
        name: 'Ship feature',
        lifecycle: 'planned',
        state: 'completed',
        created_at: '2026-03-10T00:00:00.000Z',
        started_at: '2026-03-10T00:10:00.000Z',
        completed_at: '2026-03-10T01:10:00.000Z',
        metadata: {
          parent_workflow_id: 'wf-root',
          child_workflow_ids: ['wf-child-1'],
        },
      },
      tasks: [
        {
          id: 'task-1',
          role: 'developer',
          state: 'completed',
          stage_name: 'implementation',
          work_item_id: 'wi-1',
          rework_count: 1,
          started_at: '2026-03-10T00:10:00.000Z',
          completed_at: '2026-03-10T00:40:00.000Z',
          metrics: { total_cost_usd: 1.25 },
          git_info: {
            commit_hash: 'abc123',
            branch: 'feature/ship',
          },
        },
        {
          id: 'task-2',
          role: 'reviewer',
          state: 'completed',
          stage_name: 'review',
          work_item_id: 'wi-2',
          rework_count: 0,
          started_at: '2026-03-10T00:45:00.000Z',
          completed_at: '2026-03-10T01:00:00.000Z',
          metrics: { total_cost_usd: 0.75 },
        },
      ],
      stages: [
        {
          name: 'implementation',
          goal: 'Build the feature',
          status: 'completed',
          gate_status: 'not_requested',
          iteration_count: 0,
          summary: 'Implementation done',
          started_at: new Date('2026-03-10T00:10:00.000Z'),
          completed_at: new Date('2026-03-10T00:42:00.000Z'),
        },
        {
          name: 'review',
          goal: 'Validate the result',
          status: 'completed',
          gate_status: 'approved',
          iteration_count: 1,
          summary: 'Reviewed and approved',
          started_at: new Date('2026-03-10T00:45:00.000Z'),
          completed_at: new Date('2026-03-10T01:05:00.000Z'),
        },
      ],
      workItems: [
        {
          id: 'wi-1',
          stage_name: 'implementation',
          column_id: 'in_progress',
          title: 'Implement feature',
          completed_at: new Date('2026-03-10T00:41:00.000Z'),
        },
        {
          id: 'wi-2',
          stage_name: 'review',
          column_id: 'done',
          title: 'Review feature',
          completed_at: new Date('2026-03-10T01:04:00.000Z'),
        },
      ],
      events: [
        {
          type: 'workflow.activation_queued',
          actor_type: 'system',
          actor_id: 'dispatcher',
          data: {
            activation_id: 'activation-1',
            event_type: 'task.agent_escalated',
            reason: 'task.agent_escalated',
            task_id: 'task-1',
            event_count: 1,
          },
          created_at: new Date('2026-03-10T00:35:00.000Z'),
        },
        {
          type: 'workflow.activation_started',
          actor_type: 'system',
          actor_id: 'dispatcher',
          data: {
            activation_id: 'activation-1',
            event_type: 'task.agent_escalated',
            reason: 'queued_events',
            task_id: 'task-orchestrator-1',
            event_count: 1,
          },
          created_at: new Date('2026-03-10T00:36:00.000Z'),
        },
        {
          type: 'stage.gate_requested',
          actor_type: 'agent',
          actor_id: 'agent-1',
          data: { stage_name: 'review', recommendation: 'approve' },
          created_at: new Date('2026-03-10T00:58:00.000Z'),
        },
        {
          type: 'task.agent_escalated',
          actor_type: 'agent',
          actor_id: 'agent-1',
          data: {
            task_id: 'task-1',
            source_task_id: 'task-1',
            stage_name: 'implementation',
            work_item_id: 'wi-1',
            target_role: 'reviewer',
          },
          created_at: new Date('2026-03-10T00:37:00.000Z'),
        },
        {
          type: 'task.escalation_task_created',
          actor_type: 'agent',
          actor_id: 'agent-1',
          data: {
            source_task_id: 'task-1',
            escalation_task_id: 'task-esc-1',
            stage_name: 'implementation',
            work_item_id: 'wi-1',
            target_role: 'reviewer',
          },
          created_at: new Date('2026-03-10T00:38:00.000Z'),
        },
        {
          type: 'workflow.activation_queued',
          actor_type: 'system',
          actor_id: 'dispatcher',
          data: {
            activation_id: 'activation-2',
            event_type: 'child_workflow.completed',
            reason: 'child_workflow.completed',
            child_workflow_id: 'wf-child-1',
            child_workflow_state: 'completed',
            parent_stage_name: 'review',
            parent_work_item_id: 'wi-2',
            outcome: { state: 'completed', task_count: 2, failed_task_count: 0 },
          },
          created_at: new Date('2026-03-10T00:57:00.000Z'),
        },
        {
          type: 'stage.gate.approve',
          actor_type: 'admin',
          actor_id: 'admin-1',
          data: { stage_name: 'review', feedback: 'Looks good' },
          created_at: new Date('2026-03-10T01:02:00.000Z'),
        },
      ],
      activations: [
        {
          activation_id: 'activation-1',
          state: 'processing',
          reason: 'task.agent_escalated',
          event_type: 'task.agent_escalated',
          task_id: 'task-orchestrator-1',
          queued_at: new Date('2026-03-10T00:35:00.000Z'),
          started_at: new Date('2026-03-10T00:36:00.000Z'),
          consumed_at: null,
          completed_at: null,
          error: null,
        },
        {
          activation_id: 'activation-2',
          state: 'completed',
          reason: 'child_workflow.completed',
          event_type: 'child_workflow.completed',
          task_id: null,
          queued_at: new Date('2026-03-10T00:57:00.000Z'),
          started_at: new Date('2026-03-10T00:57:30.000Z'),
          consumed_at: new Date('2026-03-10T00:58:00.000Z'),
          completed_at: new Date('2026-03-10T00:58:00.000Z'),
          error: {
            recovery: {
              status: 'stale_detected',
            },
          },
        },
      ],
      gates: [
        {
          id: 'gate-1',
          stage_name: 'review',
          status: 'approved',
          request_summary: 'Ready for review',
          recommendation: 'approve',
          concerns: [],
          key_artifacts: [],
          requested_by_type: 'agent',
          requested_by_id: 'agent-1',
          requested_at: new Date('2026-03-10T00:58:00.000Z'),
          decision_feedback: 'Looks good',
          decided_by_type: 'admin',
          decided_by_id: 'admin-1',
          decided_at: new Date('2026-03-10T01:02:00.000Z'),
        },
      ],
      artifacts: [
        {
          id: 'artifact-1',
          task_id: 'task-1',
          logical_path: 'artifacts/build.log',
          content_type: 'text/plain',
          size_bytes: 128,
          created_at: new Date('2026-03-10T00:39:00.000Z'),
        },
      ],
    });

    expect(summary.lifecycle).toBe('planned');
    expect(summary.activation_activity).toEqual(
      expect.objectContaining({
        total_events: 2,
        queued_count: 0,
        started_count: 2,
        stale_detected_count: 1,
        latest_activation_id: 'activation-2',
        batches: expect.arrayContaining([
          expect.objectContaining({
            activation_id: 'activation-1',
            status: 'in_progress',
            trigger_event_types: ['task.agent_escalated'],
          }),
          expect.objectContaining({
            activation_id: 'activation-2',
            trigger_event_types: ['child_workflow.completed'],
          }),
        ]),
      }),
    );
    expect(summary.work_item_activity).toEqual(
      expect.objectContaining({
        total: 2,
        completed: 2,
        by_column: { in_progress: 1, done: 1 },
      }),
    );
    expect(summary.gate_activity).toEqual(
      expect.objectContaining({
        open_gate_count: 0,
        requested_count: 1,
        approved_count: 1,
      }),
    );
    expect(summary.escalation_activity).toEqual(
      expect.objectContaining({
        active_count: 0,
        escalated_count: 1,
        escalation_task_count: 1,
        chains: [
          expect.objectContaining({
            source_task_id: 'task-1',
            escalation_task_id: 'task-esc-1',
            target_role: 'reviewer',
            status: 'delegated',
          }),
        ],
      }),
    );
    expect(summary.child_workflow_activity).toEqual(
      expect.objectContaining({
        source_workflow_id: 'wf-root',
        child_workflow_count: 1,
        completion_event_count: 1,
        latest_child_workflow_id: 'wf-child-1',
        transitions: [
          expect.objectContaining({
            activation_id: 'activation-2',
            child_workflow_id: 'wf-child-1',
            child_workflow_state: 'completed',
          }),
        ],
      }),
    );
    expect(summary.orchestrator_analytics).toEqual(
      expect.objectContaining({
        activation_count: 2,
        stale_detection_count: 1,
        total_rework_cycles: 1,
        reworked_task_count: 1,
        rework_rate: 0.5,
        total_cost_usd: 2,
        cost_by_stage: expect.arrayContaining([
          expect.objectContaining({ stage_name: 'implementation', total_cost_usd: 1.25 }),
          expect.objectContaining({ stage_name: 'review', total_cost_usd: 0.75 }),
        ]),
        cost_by_work_item: expect.arrayContaining([
          expect.objectContaining({ work_item_id: 'wi-1', total_cost_usd: 1.25 }),
          expect.objectContaining({ work_item_id: 'wi-2', total_cost_usd: 0.75 }),
        ]),
      }),
    );
    expect(summary).not.toHaveProperty('task_counts');
    expect(summary.stage_progression).toEqual([
      expect.objectContaining({
        name: 'implementation',
        status: 'completed',
        work_item_count: 1,
        completed_work_item_count: 1,
      }),
      expect.objectContaining({
        name: 'review',
        gate_status: 'approved',
        work_item_count: 1,
      }),
    ]);
    expect(summary.stage_metrics).toEqual([
      expect.objectContaining({
        name: 'implementation',
        work_item_counts: expect.objectContaining({
          total: 1,
          completed: 1,
          by_column: { in_progress: 1 },
        }),
      }),
      expect.objectContaining({
        name: 'review',
        gate_history: [
          expect.objectContaining({ action: 'requested', recommendation: 'approve' }),
          expect.objectContaining({ action: 'approve', feedback: 'Looks good' }),
        ],
      }),
    ]);
    expect(summary.stage_metrics[0]).not.toHaveProperty('task_counts');
    expect(summary.produced_artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'file', artifact_id: 'artifact-1' }),
        expect.objectContaining({ kind: 'commit', commit_hash: 'abc123' }),
        expect.objectContaining({ kind: 'branch', branch: 'feature/ship' }),
      ]),
    );
    expect(summary).not.toHaveProperty('chain');
    expect(summary.workflow_relations).toEqual({
      parent: expect.objectContaining({
        workflow_id: 'wf-root',
        state: 'unknown',
      }),
      children: [expect.objectContaining({ workflow_id: 'wf-child-1', state: 'unknown' })],
      latest_child_workflow_id: null,
      child_status_counts: {
        total: 1,
        active: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
      },
    });
    expect(summary.stage_activity).toBeNull();
  });
});
