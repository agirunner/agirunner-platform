import { describe, expect, it } from 'vitest';

import { buildPlaybookRunSummary } from '../../src/services/playbook-run-summary.js';

describe('buildPlaybookRunSummary', () => {
  it('builds stage-based progression and metrics for playbook workflows', () => {
    const summary = buildPlaybookRunSummary({
      workflow: {
        id: 'wf-1',
        name: 'Ship feature',
        lifecycle: 'standard',
        state: 'completed',
        created_at: '2026-03-10T00:00:00.000Z',
        started_at: '2026-03-10T00:10:00.000Z',
        completed_at: '2026-03-10T01:10:00.000Z',
        metadata: {
          chain_source_workflow_id: 'wf-root',
          child_workflow_ids: ['wf-child-1'],
        },
      },
      tasks: [
        {
          id: 'task-1',
          role: 'developer',
          state: 'completed',
          stage_name: 'implementation',
          rework_count: 1,
          started_at: '2026-03-10T00:10:00.000Z',
          completed_at: '2026-03-10T00:40:00.000Z',
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
          rework_count: 0,
          started_at: '2026-03-10T00:45:00.000Z',
          completed_at: '2026-03-10T01:00:00.000Z',
        },
      ],
      stages: [
        {
          name: 'implementation',
          goal: 'Build the feature',
          human_gate: false,
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
          human_gate: true,
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
          type: 'stage.gate_requested',
          actor_type: 'agent',
          actor_id: 'agent-1',
          data: { stage_name: 'review', recommendation: 'approve' },
          created_at: new Date('2026-03-10T00:58:00.000Z'),
        },
        {
          type: 'stage.gate.approve',
          actor_type: 'admin',
          actor_id: 'admin-1',
          data: { stage_name: 'review', feedback: 'Looks good' },
          created_at: new Date('2026-03-10T01:02:00.000Z'),
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

    expect(summary.lifecycle).toBe('standard');
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
        task_counts: expect.objectContaining({ completed: 1, total: 1 }),
        work_item_counts: expect.objectContaining({
          total: 1,
          completed: 1,
          by_column: { in_progress: 1 },
        }),
      }),
      expect.objectContaining({
        name: 'review',
        human_gate: true,
        gate_history: [
          expect.objectContaining({ action: 'requested', recommendation: 'approve' }),
          expect.objectContaining({ action: 'approve', feedback: 'Looks good' }),
        ],
      }),
    ]);
    expect(summary.produced_artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'file', artifact_id: 'artifact-1' }),
        expect.objectContaining({ kind: 'commit', commit_hash: 'abc123' }),
        expect.objectContaining({ kind: 'branch', branch: 'feature/ship' }),
      ]),
    );
    expect(summary.chain).toEqual({
      source_workflow_id: 'wf-root',
      child_workflow_ids: ['wf-child-1'],
      latest_child_workflow_id: null,
    });
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

  it('removes sequential stage progression from continuous workflow summaries', () => {
    const summary = buildPlaybookRunSummary({
      workflow: {
        id: 'wf-2',
        name: 'Continuous intake',
        lifecycle: 'continuous',
        state: 'active',
        created_at: '2026-03-10T00:00:00.000Z',
        started_at: '2026-03-10T00:05:00.000Z',
        completed_at: null,
        metadata: {},
      },
      tasks: [
        {
          id: 'task-1',
          role: 'developer',
          state: 'completed',
          stage_name: 'implementation',
          rework_count: 0,
        },
      ],
      stages: [
        {
          name: 'triage',
          goal: 'Sort incoming work',
          human_gate: false,
          status: 'active',
          gate_status: 'not_requested',
          iteration_count: 0,
          summary: null,
          started_at: new Date('2026-03-10T00:05:00.000Z'),
          completed_at: null,
        },
        {
          name: 'implementation',
          goal: 'Implement requested work',
          human_gate: false,
          status: 'completed',
          gate_status: 'not_requested',
          iteration_count: 0,
          summary: null,
          started_at: new Date('2026-03-10T00:10:00.000Z'),
          completed_at: new Date('2026-03-10T00:40:00.000Z'),
        },
      ],
      workItems: [
        {
          id: 'wi-1',
          stage_name: 'triage',
          column_id: 'queued',
          title: 'Triage new request',
          completed_at: null,
        },
        {
          id: 'wi-2',
          stage_name: 'implementation',
          column_id: 'done',
          title: 'Implement request',
          completed_at: new Date('2026-03-10T00:39:00.000Z'),
        },
      ],
      events: [],
      artifacts: [],
    });

    expect(summary.lifecycle).toBe('continuous');
    expect(summary.stage_progression).toBeNull();
    expect(summary.stage_activity).toEqual([
      expect.objectContaining({
        name: 'triage',
        status: 'active',
        total_work_item_count: 1,
        open_work_item_count: 1,
        completed_work_item_count: 0,
      }),
      expect.objectContaining({
        name: 'implementation',
        status: 'completed',
        total_work_item_count: 1,
        open_work_item_count: 0,
        completed_work_item_count: 1,
      }),
    ]);
  });
});
