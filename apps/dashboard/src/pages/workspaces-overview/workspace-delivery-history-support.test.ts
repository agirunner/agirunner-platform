import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildWorkspaceDeliveryAttentionOverview,
  buildWorkspaceDeliveryAttentionState,
  buildWorkspaceDeliveryPacket,
} from './workspace-delivery-history-support.js';

describe('workspace delivery history support', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('builds operator packets with compact delivery signals instead of the old metric grid', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-12T21:00:00Z'));

    const packet = buildWorkspaceDeliveryPacket({
      workflow_id: 'workflow-1',
      name: 'Release candidate',
      state: 'active',
      created_at: '2026-03-12T20:30:00Z',
      duration_seconds: 1800,
      stage_progression: [{ status: 'completed' }, { status: 'running' }],
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
      workflowHref: '/workflows/workflow-1',
      inspectorHref: '/diagnostics/live-logs?workflow=workflow-1&view=summary',
      stateLabel: 'active',
      stateVariant: 'default',
      createdLabel: '30m ago',
      createdTitle: new Date('2026-03-12T20:30:00Z').toLocaleString(),
      durationLabel: '30m 0s',
      signals: [
        '1 gate waiting',
        '2 open work items',
        '1/2 stages done',
        '4 activations',
        '1 reworked step',
      ],
    });
  });

  it('builds delivery overview packets around operator questions and the next inspection target', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-12T21:00:00Z'));

    const overview = buildWorkspaceDeliveryAttentionOverview([
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
    ] as never);

    expect(overview).toEqual({
      summary: 'Run 1 ran most recently. Run 2 is the next inspection target because it failed.',
      nextActionHref: '/diagnostics/live-logs?workflow=workflow-2&view=summary',
      packets: [
        { label: 'What ran', value: 'Run 1', detail: 'Active, started 30m ago.' },
        { label: 'What failed', value: 'Run 2', detail: '1 failed run needs review.' },
        {
          label: 'Needs attention',
          value: 'Run 2 + 1 more',
          detail: '2 runs still need operator follow-up.',
        },
        {
          label: 'Inspect next',
          value: 'Run 2',
          detail: 'Failed runs take priority over active work.',
        },
      ],
    });
  });

  it('builds attention guidance that keeps failed and paused runs action-forward', () => {
    const failedState = buildWorkspaceDeliveryAttentionState({
      workflow_id: 'workflow-2',
      name: 'Run 2',
      state: 'failed',
      created_at: '2026-03-12T19:30:00Z',
      stage_metrics: [],
    } as never);
    const pausedState = buildWorkspaceDeliveryAttentionState({
      workflow_id: 'workflow-3',
      name: 'Run 3',
      state: 'paused',
      created_at: '2026-03-12T18:30:00Z',
      stage_metrics: [],
      link: '/workflows/workflow-3',
    } as never);

    expect(failedState).toEqual({
      statusLabel: 'Failed',
      attentionLabel: 'Needs immediate review',
      nextAction: 'Start with inspector: confirm the failing activation and affected work items.',
      primaryActionHref: '/diagnostics/live-logs?workflow=workflow-2&view=summary',
    });
    expect(pausedState).toEqual({
      statusLabel: 'Paused',
      attentionLabel: 'Review blocked progress',
      nextAction: 'Open board: resolve the blocked gate or work item before resuming.',
      primaryActionHref: '/workflows/workflow-3',
    });
  });
});
