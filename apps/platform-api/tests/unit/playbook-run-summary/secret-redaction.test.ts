import { describe, expect, it } from 'vitest';

import { buildPlaybookRunSummary } from '../../../src/services/playbook-run-summary.js';

describe('buildPlaybookRunSummary', () => {
  it('catches embedded bearer tokens within workflow summary prose values', () => {
    const summary = buildPlaybookRunSummary({
      workflow: {
        id: 'wf-embedded',
        name: 'Embedded token flow',
        lifecycle: 'planned',
        state: 'completed',
        created_at: '2026-03-10T00:00:00.000Z',
        started_at: '2026-03-10T00:10:00.000Z',
        completed_at: '2026-03-10T00:20:00.000Z',
        metadata: {},
      },
      tasks: [
        {
          id: 'task-embedded',
          role: 'developer',
          state: 'completed',
          stage_name: 'review',
          rework_count: 0,
          metrics: { total_cost_usd: 0 },
        },
      ],
      stages: [
        {
          name: 'review',
          goal: 'Review work',
          status: 'completed',
          gate_status: 'not_requested',
          iteration_count: 0,
          summary: 'Completed. Validate with Bearer sk-live-review-secret if needed.',
          started_at: new Date('2026-03-10T00:10:00.000Z'),
          completed_at: new Date('2026-03-10T00:20:00.000Z'),
        },
      ],
      workItems: [],
      events: [],
      artifacts: [],
    });

    expect(summary.stage_metrics[0].summary).toBe('redacted://workflow-summary-secret');
    expect(summary.stage_metrics[0].name).toBe('review');
    expect(summary.stage_metrics[0].goal).toBe('Review work');
  });

  it('redacts secret-bearing values from workflow summary packets', () => {
    const summary = buildPlaybookRunSummary({
      workflow: {
        id: 'wf-secret',
        name: 'Secret flow',
        lifecycle: 'planned',
        state: 'completed',
        created_at: '2026-03-10T00:00:00.000Z',
        started_at: '2026-03-10T00:10:00.000Z',
        completed_at: '2026-03-10T00:20:00.000Z',
        metadata: {},
      },
      tasks: [
        {
          id: 'task-secret',
          role: 'developer',
          state: 'completed',
          stage_name: 'review',
          work_item_id: 'wi-secret',
          rework_count: 0,
          metrics: { total_cost_usd: 1.5 },
          git_info: {
            linked_prs: [
              {
                url: 'https://github.com/agisnap/agirunner-test-fixtures/pull/1',
                authorization: 'secret:PR_SECRET',
              },
            ],
          },
        },
      ],
      stages: [
        {
          name: 'review',
          goal: 'Review work',
          status: 'completed',
          gate_status: 'approved',
          iteration_count: 0,
          summary: 'Bearer stage-secret',
          started_at: new Date('2026-03-10T00:10:00.000Z'),
          completed_at: new Date('2026-03-10T00:20:00.000Z'),
        },
      ],
      workItems: [
        {
          id: 'wi-secret',
          stage_name: 'review',
          column_id: 'done',
          title: 'Review release',
          completed_at: new Date('2026-03-10T00:19:00.000Z'),
        },
      ],
      events: [
        {
          type: 'child_workflow.completed',
          actor_type: 'system',
          actor_id: 'dispatcher',
          data: {
            workflow_id: 'wf-secret',
            child_workflow_id: 'wf-child',
            child_workflow_state: 'completed',
            outcome: {
              access_token: 'secret:CHILD_SECRET',
            },
          },
          created_at: new Date('2026-03-10T00:15:00.000Z'),
        },
      ],
      activations: [],
      gates: [
        {
          id: 'gate-secret',
          stage_name: 'review',
          status: 'approved',
          request_summary: 'secret:GATE_SECRET',
          recommendation: 'approve',
          concerns: [{ api_key: 'Bearer gate-concern-secret' }],
          key_artifacts: [{ note: 'secret:ARTIFACT_SECRET' }],
          requested_by_type: 'agent',
          requested_by_id: 'agent-1',
          requested_at: new Date('2026-03-10T00:12:00.000Z'),
          decision_feedback: 'secret:DECISION_SECRET',
          decided_by_type: 'admin',
          decided_by_id: 'admin-1',
          decided_at: new Date('2026-03-10T00:18:00.000Z'),
        },
      ],
      artifacts: [],
    });

    expect(summary.stage_metrics[0].summary).toBe('redacted://workflow-summary-secret');
    expect(summary.stage_metrics[0].gate_history[0].feedback).toBe('redacted://workflow-summary-secret');
    expect(summary.stage_metrics[0].gate_history[1].feedback).toBe('redacted://workflow-summary-secret');
    expect(summary.child_workflow_activity.transitions[0].outcome.access_token).toBe(
      'redacted://workflow-summary-secret',
    );
    expect((summary.produced_artifacts[0] as Record<string, any>).reference.authorization).toBe(
      'redacted://workflow-summary-secret',
    );
  });
});
