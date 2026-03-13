import { describe, expect, it } from 'vitest';

import {
  describeCollectionAttention,
  describeCollectionProgress,
  describeCollectionSpend,
  describeGateSummary,
  describeWorkflowCost,
  describeWorkflowProgress,
  describeOperatorSignal,
  describeWorkItemSummary,
  describeWorkflowStage,
  describeWorkflowType,
  formatRelativeRunAge,
  formatTaskProgress,
  normalizeWorkflows,
  resolveStatus,
  resolveTypeFilter,
  summarizeWorkflowCollection,
} from './workflow-list-support.js';

describe('workflow list support', () => {
  it('normalizes wrapped workflow collections', () => {
    expect(
      normalizeWorkflows({
        data: [{ id: 'workflow-1', name: 'Alpha', status: 'running', created_at: '2026-03-11' }],
      }),
    ).toEqual([{ id: 'workflow-1', name: 'Alpha', status: 'running', created_at: '2026-03-11' }]);
  });

  it('describes playbook stage and work-item summary for v2 workflows', () => {
    const workflow = {
      id: 'workflow-1',
      name: 'Alpha',
      status: 'running',
      created_at: '2026-03-11',
      playbook_id: 'playbook-1',
      lifecycle: 'continuous' as const,
      active_stages: ['implementation'],
      work_item_summary: {
        total_work_items: 5,
        open_work_item_count: 3,
        completed_work_item_count: 2,
        active_stage_count: 1,
        awaiting_gate_count: 1,
        active_stage_names: ['implementation'],
      },
    };

    expect(describeWorkflowType(workflow)).toBe('Continuous board run');
    expect(describeWorkflowStage(workflow)).toBe('implementation');
    expect(describeWorkItemSummary(workflow)).toBe('3 open / 5 total, 1 live stage');
    expect(describeWorkflowProgress(workflow)).toBe('2 of 5 work items complete');
    expect(describeGateSummary(workflow)).toBe('1 gate waiting');
    expect(describeOperatorSignal(workflow)).toBe('1 gate waiting');
    expect(resolveStatus(workflow)).toBe('gated');
    expect(resolveTypeFilter(workflow)).toBe('continuous');
  });

  it('prefers active work-item stages over workflow current_stage for continuous workflows', () => {
    const workflow = {
      id: 'workflow-2',
      name: 'Beta',
      status: 'running',
      created_at: '2026-03-11',
      lifecycle: 'continuous' as const,
      current_stage: 'legacy-review',
      active_stages: ['implementation'],
      work_item_summary: {
        total_work_items: 4,
        open_work_item_count: 2,
        completed_work_item_count: 2,
        active_stage_count: 2,
        awaiting_gate_count: 0,
        active_stage_names: ['implementation', 'verification'],
      },
    };

    expect(describeWorkflowStage(workflow)).toBe('implementation, verification');
  });

  it('prefers work-item summary stage ordering over top-level active stage arrays for continuous workflows', () => {
    const workflow = {
      id: 'workflow-2c',
      name: 'Ordered Continuous',
      status: 'running',
      created_at: '2026-03-11',
      lifecycle: 'continuous' as const,
      active_stages: ['verification', 'implementation'],
      work_item_summary: {
        total_work_items: 4,
        open_work_item_count: 2,
        completed_work_item_count: 2,
        active_stage_count: 2,
        awaiting_gate_count: 0,
        active_stage_names: ['implementation', 'verification'],
      },
    };

    expect(describeWorkflowStage(workflow)).toBe('implementation, verification');
  });

  it('does not fall back to workflow current_stage for continuous workflows without live work', () => {
    const workflow = {
      id: 'workflow-2b',
      name: 'Idle Continuous',
      status: 'pending',
      created_at: '2026-03-11',
      lifecycle: 'continuous' as const,
      current_stage: 'legacy-review',
      active_stages: [],
      work_item_summary: {
        total_work_items: 0,
        open_work_item_count: 0,
        completed_work_item_count: 0,
        active_stage_count: 0,
        awaiting_gate_count: 0,
        active_stage_names: [],
      },
    };

    expect(describeWorkflowStage(workflow)).toBe('No live stages');
  });

  it('treats standard workflows as the default active type', () => {
    const workflow = {
      id: 'workflow-1',
      name: 'Standard Flow',
      status: 'running',
      created_at: '2026-03-11',
      current_stage: 'review',
      task_counts: { completed: 2, running: 1 },
    };

    expect(describeWorkflowType(workflow)).toBe('Milestone board run');
    expect(describeWorkflowStage(workflow)).toBe('review');
    expect(describeWorkItemSummary(workflow)).toBe('No work items');
    expect(describeWorkflowProgress(workflow)).toBe('No work items queued');
    expect(formatTaskProgress(workflow.task_counts)).toBe('2/3');
    expect(resolveStatus(workflow)).toBe('planned');
    expect(resolveTypeFilter(workflow)).toBe('standard');
  });

  it('uses a readable standard fallback when no stage is assigned', () => {
    expect(
      describeWorkflowStage({
        id: 'workflow-1b',
        name: 'No Stage',
        status: 'pending',
        created_at: '2026-03-11',
      }),
    ).toBe('No stage assigned');
  });

  it('prioritizes live work posture before raw workflow state', () => {
    const workflow = {
      id: 'workflow-3',
      name: 'Gamma',
      status: 'failed',
      state: 'failed',
      created_at: '2026-03-11',
      lifecycle: 'continuous' as const,
      active_stages: ['implementation'],
      work_item_summary: {
        total_work_items: 4,
        open_work_item_count: 2,
        completed_work_item_count: 2,
        active_stage_count: 1,
        awaiting_gate_count: 0,
        active_stage_names: ['implementation'],
      },
    };

    expect(resolveStatus(workflow)).toBe('active');
    expect(describeOperatorSignal(workflow)).toBe('2 open work items across 1 live stage');
  });

  it('uses delivery-centric blocked and terminal fallback signals', () => {
    expect(
      describeOperatorSignal({
        id: 'workflow-4',
        name: 'Done',
        status: 'completed',
        created_at: '2026-03-11',
      }),
    ).toBe('Board run complete');

    expect(
      describeOperatorSignal({
        id: 'workflow-5',
        name: 'Paused',
        status: 'paused',
        created_at: '2026-03-11',
      }),
    ).toBe('Stage or gate work paused');

    expect(
      describeOperatorSignal({
        id: 'workflow-6',
        name: 'Cancelled',
        status: 'cancelled',
        created_at: '2026-03-11',
      }),
    ).toBe('Board run cancelled');

    expect(
      describeOperatorSignal({
        id: 'workflow-7',
        name: 'Failed',
        status: 'failed',
        created_at: '2026-03-11',
      }),
    ).toBe('Board run blocked by failure');
  });

  it('formats workflow spend and relative age for operator-facing cards', () => {
    expect(
      describeWorkflowCost({
        id: 'workflow-8',
        name: 'Spend',
        status: 'running',
        created_at: '2026-03-11',
        cost: 12.345,
      }),
    ).toBe('$12.35 reported');
    expect(
      describeWorkflowCost({
        id: 'workflow-9',
        name: 'No Spend',
        status: 'running',
        created_at: '2026-03-11',
      }),
    ).toBe('No spend reported');
    expect(formatRelativeRunAge('2026-03-12T11:30:00.000Z', new Date('2026-03-12T12:00:00.000Z').getTime())).toBe(
      'Started 30m ago',
    );
  });

  it('summarizes visible workflow posture, gates, work, and spend', () => {
    expect(
      summarizeWorkflowCollection([
        {
          id: 'workflow-1',
          name: 'Active',
          status: 'running',
          created_at: '2026-03-11',
          cost: 3.5,
          work_item_summary: {
            total_work_items: 5,
            open_work_item_count: 3,
            completed_work_item_count: 2,
            active_stage_count: 1,
            awaiting_gate_count: 0,
            active_stage_names: ['implementation'],
          },
        },
        {
          id: 'workflow-2',
          name: 'Gated',
          status: 'running',
          created_at: '2026-03-11',
          cost: 1.25,
          work_item_summary: {
            total_work_items: 4,
            open_work_item_count: 1,
            completed_work_item_count: 3,
            active_stage_count: 1,
            awaiting_gate_count: 1,
            active_stage_names: ['review'],
          },
        },
      ]),
    ).toEqual({
      total: 2,
      active: 1,
      gated: 1,
      blocked: 0,
      done: 0,
      openWorkItems: 4,
      completedWorkItems: 5,
      awaitingGates: 1,
      reportedSpend: 4.75,
      spentBoards: 2,
    });
  });

  it('describes collection-level progress, attention, and spend coverage for operators', () => {
    const summary = {
      total: 4,
      active: 1,
      gated: 2,
      blocked: 1,
      done: 0,
      openWorkItems: 6,
      completedWorkItems: 9,
      awaitingGates: 2,
      reportedSpend: 12.5,
      spentBoards: 3,
    };

    expect(describeCollectionProgress(summary)).toBe('6 open • 9 complete');
    expect(describeCollectionAttention(summary)).toBe('2 gated • 1 blocked');
    expect(describeCollectionSpend(summary)).toBe('3 of 4 boards reporting spend');
  });
});
