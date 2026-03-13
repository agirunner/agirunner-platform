import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildProjectDeliveryOverview,
  buildProjectDeliveryPacket,
} from './project-delivery-history-support.js';

describe('project delivery history support', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('builds operator packets with stage, gate, artifact, and spend posture', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-12T21:00:00Z'));

    const packet = buildProjectDeliveryPacket({
      workflow_id: 'workflow-1',
      name: 'Release candidate',
      state: 'active',
      created_at: '2026-03-12T20:30:00Z',
      duration_seconds: 1800,
      stage_progression: [
        { status: 'completed' },
        { status: 'running' },
      ],
      stage_metrics: [
        { work_item_counts: { total: 5, open: 2 }, gate_status: 'awaiting_approval' },
      ],
      orchestrator_analytics: {
        activation_count: 4,
        reworked_task_count: 1,
        stale_detection_count: 2,
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
      workflowHref: '/work/boards/workflow-1',
      inspectorHref: '/work/boards/workflow-1/inspector',
      stateLabel: 'active',
      stateVariant: 'default',
      createdLabel: '30m ago',
      createdTitle: new Date('2026-03-12T20:30:00Z').toLocaleString(),
      durationLabel: '30m 0s',
      summary:
        'This run is still active. Check stage progress, gate pressure, and recent spend before intervening.',
      metrics: [
        { label: 'Stages', value: '1/2' },
        { label: 'Work items', value: '3/5 closed' },
        { label: 'Waiting gates', value: '1' },
        { label: 'Activations', value: '4' },
        { label: 'Reworked steps', value: '1' },
        { label: 'Stale recoveries', value: '2' },
        { label: 'Artifacts', value: '2' },
        { label: 'Child workflows', value: '1/2 complete' },
        { label: 'Reported spend', value: '$5.25' },
      ],
    });
  });

  it('builds delivery overview packets for the project history surface', () => {
    const overview = buildProjectDeliveryOverview([
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
        { label: 'Runs', value: '2' },
        { label: 'Active', value: '1' },
        { label: 'Failed', value: '1' },
        { label: 'Waiting gates', value: '1' },
        { label: 'Reported spend', value: '$3.75' },
      ],
      summary: '1 run still needs operator monitoring.',
    });
  });
});
