import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildWorkspaceDeliveryAttentionOverview,
  buildWorkspaceDeliveryAttentionState,
  buildWorkspaceDeliveryPacket,
} from './workspace-delivery-history-support.js';

describe('workspace delivery history question-driven support', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('builds a top summary that answers what ran, what failed, what needs attention, and what to inspect next', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-12T21:00:00Z'));

    const overview = buildWorkspaceDeliveryAttentionOverview([
      {
        workflow_id: 'workflow-1',
        name: 'Release candidate',
        state: 'active',
        created_at: '2026-03-12T20:30:00Z',
        stage_metrics: [{ gate_status: 'awaiting_approval' }],
      },
      {
        workflow_id: 'workflow-2',
        name: 'Backfill cleanup',
        state: 'failed',
        created_at: '2026-03-12T19:30:00Z',
        stage_metrics: [],
      },
    ] as never);

    expect(overview.summary).toContain('Release candidate');
    expect(overview.packets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'What ran',
          value: 'Release candidate',
          detail: 'Active, started 30m ago.',
        }),
        expect.objectContaining({
          label: 'What failed',
          value: 'Backfill cleanup',
          detail: '1 failed run needs review.',
        }),
        expect.objectContaining({
          label: 'Needs attention',
          value: 'Backfill cleanup + 1 more',
          detail: '2 runs still need operator follow-up.',
        }),
        expect.objectContaining({
          label: 'Inspect next',
          value: 'Backfill cleanup',
          detail: 'Failed runs take priority over active work.',
        }),
      ]),
    );
    expect(overview.nextActionHref).toBe('/work/boards/workflow-2/inspector');
  });

  it('describes per-run attention and inspection guidance for failed delivery', () => {
    const state = buildWorkspaceDeliveryAttentionState({
      workflow_id: 'workflow-2',
      name: 'Backfill cleanup',
      state: 'failed',
      created_at: '2026-03-12T19:30:00Z',
      stage_metrics: [],
      link: '/work/boards/workflow-2',
    } as never);

    expect(state.statusLabel).toBe('Failed');
    expect(state.attentionLabel).toBe('Needs immediate review');
    expect(state.nextAction).toBe(
      'Start with inspector: confirm the failing activation and affected work items.',
    );
    expect(state.primaryActionHref).toBe('/work/boards/workflow-2/inspector');
  });

  it('compresses delivery metrics into terse operator signals for each run', () => {
    const packet = buildWorkspaceDeliveryPacket({
      workflow_id: 'workflow-1',
      name: 'Release candidate',
      state: 'active',
      created_at: '2026-03-12T20:30:00Z',
      stage_progression: [{ status: 'completed' }, { status: 'running' }],
      stage_metrics: [
        {
          gate_status: 'awaiting_approval',
          work_item_counts: { total: 3, open: 1 },
        },
      ],
      orchestrator_analytics: {
        activation_count: 3,
        reworked_task_count: 1,
        total_cost_usd: 4.5,
      },
      produced_artifacts: [{ id: 'artifact-1' }],
    } as never);

    expect(packet.stateLabel).toBe('active');
    expect(packet.durationLabel).toBeNull();
    expect(packet.signals).toEqual([
      '1 gate waiting',
      '1 open work item',
      '1/2 stages done',
      '3 activations',
      '1 reworked step',
    ]);
  });
});
