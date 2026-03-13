import { describe, expect, it } from 'vitest';

import {
  countActiveSpecialistSteps,
  countBlockedBoardItems,
  countEscalatedSteps,
  countOpenBoardItems,
  countReworkHeavySteps,
  countSpecialistReviewQueue,
  describeBoardHeadline,
  describeBoardProgress,
  describeBoardSpend,
  describeBoardTokens,
  describeFleetHeadline,
  describeOrchestratorPool,
  describeRiskPosture,
  describeSpecialistPool,
  describeWorkflowStage,
  describeWorkerCapacity,
  formatRelativeTimestamp,
  isLiveWorkflow,
  resolveBoardPosture,
  summarizeActivationHealth,
  summarizeWorkerFleet,
  summarizeVisibleTokenUsage,
} from './live-board-support.js';

describe('live board support', () => {
  const board = {
    columns: [
      { id: 'planned', label: 'Planned' },
      { id: 'active', label: 'Active' },
      { id: 'blocked', label: 'Blocked', is_blocked: true },
      { id: 'done', label: 'Done', is_terminal: true },
    ],
    work_items: [
      { id: 'wi-1', workflow_id: 'wf-1', stage_name: 'build', title: 'Ship build', column_id: 'active', priority: 'high' },
      { id: 'wi-2', workflow_id: 'wf-1', stage_name: 'review', title: 'Unblock QA', column_id: 'blocked', priority: 'normal' },
      { id: 'wi-3', workflow_id: 'wf-1', stage_name: 'release', title: 'Release', column_id: 'done', priority: 'normal' },
    ],
    stage_summary: [],
  };

  it('counts open and blocked work items from board columns', () => {
    expect(countOpenBoardItems(board as never)).toBe(2);
    expect(countBlockedBoardItems(board as never)).toBe(1);
  });

  it('describes the current stage footprint', () => {
    expect(describeWorkflowStage({ current_stage: 'implementation' })).toBe('implementation');
    expect(describeWorkflowStage({ active_stages: ['implementation', 'review'] })).toBe('implementation, review');
    expect(
      describeWorkflowStage({
        lifecycle: 'continuous',
        current_stage: 'legacy-stage',
        active_stages: ['implementation'],
        work_item_summary: {
          total_work_items: 3,
          open_work_item_count: 2,
          awaiting_gate_count: 0,
          active_stage_names: ['implementation', 'review'],
        },
      }),
    ).toBe('implementation, review');
    expect(
      describeWorkflowStage({
        lifecycle: 'continuous',
        current_stage: 'legacy-stage',
      }),
    ).toBe('No live stages');
    expect(describeWorkflowStage({})).toBe('No stage assigned');
  });

  it('prefers blocked and gate posture before generic active state', () => {
    expect(resolveBoardPosture({ state: 'running', work_item_summary: { total_work_items: 3, open_work_item_count: 2, awaiting_gate_count: 0 } }, board as never)).toBe('blocked');
    expect(resolveBoardPosture({ state: 'running', work_item_summary: { total_work_items: 3, open_work_item_count: 1, awaiting_gate_count: 1 } })).toBe('awaiting gate');
    expect(resolveBoardPosture({ state: 'running', work_item_summary: { total_work_items: 3, open_work_item_count: 1, awaiting_gate_count: 0 } })).toBe('active');
    expect(resolveBoardPosture({ state: 'completed', work_item_summary: { total_work_items: 3, open_work_item_count: 0, awaiting_gate_count: 0 } })).toBe('done');
  });

  it('keeps workflow.state as a fallback when richer board posture is absent', () => {
    expect(
      describeBoardHeadline(
        {
          state: 'failed',
          work_item_summary: {
            total_work_items: 0,
            open_work_item_count: 0,
            awaiting_gate_count: 0,
          },
        },
      ),
    ).toBe('Board execution failed');
    expect(isLiveWorkflow({ state: 'failed' })).toBe(true);
    expect(isLiveWorkflow({ state: 'completed' })).toBe(false);
  });

  it('prioritizes open work and gate posture over raw workflow state', () => {
    const workflow = {
      state: 'failed',
      work_item_summary: {
        total_work_items: 4,
        open_work_item_count: 2,
        awaiting_gate_count: 1,
      },
    };

    expect(resolveBoardPosture(workflow)).toBe('awaiting gate');
    expect(describeBoardHeadline(workflow)).toBe('1 gate review waiting');
    expect(isLiveWorkflow(workflow)).toBe(true);
  });

  it('describes board progress, spend, and relative time for operator summaries', () => {
    expect(
      describeBoardProgress({
        work_item_summary: {
          total_work_items: 6,
          completed_work_item_count: 4,
          open_work_item_count: 2,
          awaiting_gate_count: 0,
        },
      }),
    ).toBe('4 of 6 work items complete');
    expect(
      describeBoardSpend({
        metrics: {
          total_cost_usd: 12.345,
        },
      }),
    ).toBe('$12.35 reported');
    expect(
      describeBoardTokens({
        metrics: {
          total_tokens: 42_500,
        },
      }),
    ).toBe('42.5K tokens');
    expect(
      formatRelativeTimestamp(
        '2026-03-12T11:45:00.000Z',
        new Date('2026-03-12T12:00:00.000Z').getTime(),
      ),
    ).toBe('15m ago');
  });

  it('summarizes orchestrator health, specialist posture, and token rollups for triage', () => {
    const tasks = [
      { status: 'ready', is_orchestrator_task: false, retry_count: 0 },
      { status: 'awaiting_approval', is_orchestrator_task: false, retry_count: 0 },
      { status: 'escalated', is_orchestrator_task: false, retry_count: 2 },
      { status: 'in_progress', is_orchestrator_task: true, retry_count: 0 },
    ];
    const activations = [
      { state: 'processing', event_count: 2 },
      {
        state: 'queued',
        event_count: 1,
        stale_started_at: '2026-03-12T12:00:00.000Z',
        recovery_status: 'redispatched',
        redispatched_task_id: 'task-1',
      },
    ];

    expect(countActiveSpecialistSteps(tasks)).toBe(1);
    expect(countSpecialistReviewQueue(tasks)).toBe(1);
    expect(countEscalatedSteps(tasks)).toBe(1);
    expect(countReworkHeavySteps(tasks)).toBe(1);

    const activationSummary = summarizeActivationHealth(activations);
    expect(activationSummary).toEqual({
      inFlight: 1,
      needsAttention: 1,
      stale: 1,
      recovered: 1,
      queuedEvents: 3,
    });
    expect(describeOrchestratorPool(activationSummary)).toBe('1 active • 1 stale • 1 recovered');
    expect(
      describeSpecialistPool({
        active: 1,
        reviews: 1,
        escalations: 1,
        reworkHeavy: 1,
      }),
    ).toBe('1 active • 1 review • 1 escalated • 1 rework-heavy');
    expect(
      describeRiskPosture({
        blocked: 2,
        gates: 1,
        failed: 1,
        escalated: 1,
        reworkHeavy: 1,
        staleActivations: 1,
      }),
    ).toBe('2 blocked • 1 gates • 1 failed • 1 escalated • 1 rework-heavy • 1 stale');
    expect(
      summarizeVisibleTokenUsage([
        { metrics: { total_tokens: 1_200 } },
        { metrics: { prompt_tokens: 2_500, completion_tokens: 900 } },
      ]),
    ).toBe('4.6K tokens reported');
  });

  it('turns raw worker telemetry into operator-capacity summaries', () => {
    const summary = summarizeWorkerFleet([
      { status: 'online', current_tasks: 2 },
      { status: 'active', current_tasks: 0 },
      { status: 'offline', current_tasks: 3 },
    ]);

    expect(summary).toEqual({
      online: 2,
      busy: 1,
      available: 1,
      offline: 1,
      assignedSteps: 2,
    });
    expect(describeWorkerCapacity({ status: 'online', current_tasks: 2 })).toBe('2 steps active');
    expect(describeWorkerCapacity({ status: 'active', current_tasks: 0 })).toBe('Available for new steps');
    expect(describeFleetHeadline(summary)).toBe('1 worker actively executing');
  });
});
