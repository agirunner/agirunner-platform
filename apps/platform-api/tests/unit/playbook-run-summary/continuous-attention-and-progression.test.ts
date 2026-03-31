import { describe, expect, it } from 'vitest';

import { buildPlaybookRunSummary } from '../../../src/services/playbook-run-summary/playbook-run-summary.js';

describe('buildPlaybookRunSummary', () => {
  it('treats multiple continuous stages in active, awaiting-gate, and blocked posture as active stage attention', () => {
    const summary = buildPlaybookRunSummary({
      workflow: {
        id: 'wf-continuous-1',
        name: 'Continuous multi-stage run',
        lifecycle: 'ongoing',
        state: 'active',
        created_at: '2026-03-10T00:00:00.000Z',
        started_at: '2026-03-10T00:05:00.000Z',
        completed_at: null,
        metadata: {},
      },
      tasks: [],
      stages: [
        {
          name: 'triage',
          goal: 'Sort incoming work',
          status: 'pending',
          gate_status: 'not_requested',
          iteration_count: 0,
          summary: null,
          started_at: new Date('2026-03-10T00:05:00.000Z'),
          completed_at: null,
        },
        {
          name: 'review',
          goal: 'Review deliverables',
          status: 'pending',
          gate_status: 'awaiting_approval',
          iteration_count: 1,
          summary: 'Awaiting operator approval',
          started_at: new Date('2026-03-10T00:15:00.000Z'),
          completed_at: null,
        },
        {
          name: 'qa',
          goal: 'Handle rejected work',
          status: 'pending',
          gate_status: 'rejected',
          iteration_count: 1,
          summary: 'Rejected until changes land',
          started_at: new Date('2026-03-10T00:20:00.000Z'),
          completed_at: null,
        },
        {
          name: 'done',
          goal: 'Finished work',
          status: 'pending',
          gate_status: 'not_requested',
          iteration_count: 0,
          summary: null,
          started_at: new Date('2026-03-10T00:25:00.000Z'),
          completed_at: new Date('2026-03-10T00:30:00.000Z'),
        },
      ],
      workItems: [
        {
          id: 'wi-1',
          stage_name: 'triage',
          column_id: 'backlog',
          title: 'Incoming item',
          completed_at: null,
        },
        {
          id: 'wi-2',
          stage_name: 'review',
          column_id: 'review',
          title: 'Review item',
          completed_at: null,
        },
        {
          id: 'wi-3',
          stage_name: 'qa',
          column_id: 'blocked',
          title: 'Rejected item',
          completed_at: null,
        },
        {
          id: 'wi-4',
          stage_name: 'done',
          column_id: 'done',
          title: 'Completed item',
          completed_at: new Date('2026-03-10T00:30:00.000Z'),
        },
      ],
      events: [],
      artifacts: [],
    });

    expect(summary.lifecycle).toBe('ongoing');
    expect(summary.stage_progression).toBeNull();
    expect(summary.stage_activity).toEqual([
      expect.objectContaining({
        name: 'triage',
        status: 'active',
        open_work_item_count: 1,
      }),
      expect.objectContaining({
        name: 'review',
        status: 'awaiting_gate',
        open_work_item_count: 1,
      }),
      expect.objectContaining({
        name: 'qa',
        status: 'blocked',
        open_work_item_count: 1,
      }),
      expect.objectContaining({
        name: 'done',
        status: 'completed',
        completed_work_item_count: 1,
      }),
    ]);
    expect(summary.work_item_activity).toEqual(
      expect.objectContaining({
        active_stage_names: ['triage', 'review', 'qa'],
      }),
    );
    expect(summary).not.toHaveProperty('chain');
  });

  it('removes sequential stage progression from continuous workflow summaries', () => {
    const summary = buildPlaybookRunSummary({
      workflow: {
        id: 'wf-2',
        name: 'Continuous intake',
        lifecycle: 'ongoing',
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

    expect(summary.lifecycle).toBe('ongoing');
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
    expect(summary).not.toHaveProperty('chain');
  });

  it('does not mark an approved continuous stage as completed without work items', () => {
    const summary = buildPlaybookRunSummary({
      workflow: {
        id: 'wf-3',
        name: 'Continuous approvals',
        lifecycle: 'ongoing',
        state: 'active',
        created_at: '2026-03-10T00:00:00.000Z',
        started_at: '2026-03-10T00:05:00.000Z',
        completed_at: null,
        metadata: {},
      },
      tasks: [],
      stages: [
        {
          name: 'review',
          goal: 'Approve work',
          status: 'completed',
          gate_status: 'approved',
          iteration_count: 0,
          summary: 'Approved without work',
          started_at: new Date('2026-03-10T00:10:00.000Z'),
          completed_at: new Date('2026-03-10T00:20:00.000Z'),
        },
      ],
      workItems: [],
      events: [],
      artifacts: [],
      activations: [],
      gates: [
        {
          id: 'gate-1',
          stage_name: 'review',
          status: 'approved',
          request_summary: 'Ready',
          recommendation: 'approve',
          concerns: [],
          key_artifacts: [],
          requested_by_type: 'agent',
          requested_by_id: 'agent-1',
          requested_at: new Date('2026-03-10T00:12:00.000Z'),
          decision_feedback: 'Approved',
          decided_by_type: 'admin',
          decided_by_id: 'admin-1',
          decided_at: new Date('2026-03-10T00:18:00.000Z'),
        },
      ],
    });

    expect(summary.stage_activity).toEqual([
      expect.objectContaining({
        name: 'review',
        status: 'pending',
        total_work_item_count: 0,
        open_work_item_count: 0,
        completed_work_item_count: 0,
        gate_status: 'approved',
      }),
    ]);
  });
});
