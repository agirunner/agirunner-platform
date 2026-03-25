import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildWorkflowWorkspaceTimelineOverview,
  buildWorkflowWorkspaceTimelinePacket,
} from './workflow-workspace-timeline-support.js';

describe('workflow workspace timeline support', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('builds a continuity packet with progress, gate, artifact, and spend posture', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-12T22:00:00Z'));

    const packet = buildWorkflowWorkspaceTimelinePacket({
      workflow_id: 'workflow-1',
      name: 'Release candidate',
      state: 'active',
      created_at: '2026-03-12T20:30:00Z',
      completed_at: null,
      stage_progression: [{ status: 'completed' }, { status: 'running' }],
      stage_metrics: [
        { work_item_counts: { total: 5, open: 2 }, gate_status: 'awaiting_approval' },
      ],
      orchestrator_analytics: {
        activation_count: 4,
        total_cost_usd: 5.25,
      },
      produced_artifacts: [{ id: 'artifact-1' }, { id: 'artifact-2' }],
      workflow_relations: {
        parent: null,
        children: [],
        latest_child_workflow_id: null,
        child_status_counts: {
          total: 2,
          active: 1,
          completed: 1,
          failed: 0,
          cancelled: 0,
        },
      },
    });

    expect(packet).toEqual({
      workflowId: 'workflow-1',
      workflowName: 'Release candidate',
      workflowHref: '/mission-control/workflows/workflow-1',
      inspectorHref: '/mission-control/workflows/workflow-1/inspector',
      stateLabel: 'active',
      summary:
        'This linked run is still active. Review progress, gate pressure, and spend before intervening.',
      nextAction:
        'Review waiting gates before treating the lineage as clear.',
      createdLabel: '2h ago',
      createdTitle: new Date('2026-03-12T20:30:00Z').toLocaleString(),
      completedLabel: 'Still in progress',
      metrics: [
        { label: 'Stages', value: '1/2' },
        { label: 'Work items', value: '3/5 closed' },
        { label: 'Waiting gates', value: '1' },
        { label: 'Activations', value: '4' },
        { label: 'Artifacts', value: '2' },
        { label: 'Reported spend', value: '$5.25' },
        { label: 'Child workflows', value: '1/2 complete' },
      ],
    });
  });

  it('builds overview metrics for the workflow-detail continuity surface', () => {
    const overview = buildWorkflowWorkspaceTimelineOverview([
      {
        workflow_id: 'workflow-1',
        name: 'Run 1',
        state: 'active',
        created_at: '2026-03-12T20:30:00Z',
        stage_metrics: [{ gate_status: 'awaiting_approval' }],
        orchestrator_analytics: { total_cost_usd: 2.5 },
      },
      {
        workflow_id: 'workflow-2',
        name: 'Run 2',
        state: 'failed',
        created_at: '2026-03-12T19:30:00Z',
        stage_metrics: [],
        orchestrator_analytics: { total_cost_usd: 1.25 },
      },
    ]);

    expect(overview).toEqual({
      metrics: [
        { label: 'Runs in view', value: '2' },
        { label: 'Active', value: '1' },
        { label: 'Failed', value: '1' },
        { label: 'Waiting gates', value: '1' },
        { label: 'Reported spend', value: '$3.75' },
      ],
      summary: '1 linked run still needs operator monitoring.',
    });
  });
});
