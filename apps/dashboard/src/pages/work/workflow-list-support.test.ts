import { describe, expect, it } from 'vitest';

import {
  describeGateSummary,
  describeOperatorSignal,
  describeWorkItemSummary,
  describeWorkflowStage,
  describeWorkflowType,
  formatTaskProgress,
  normalizeWorkflows,
  resolveStatus,
  resolveTypeFilter,
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

    expect(describeWorkflowType(workflow)).toBe('Continuous board');
    expect(describeWorkflowStage(workflow)).toBe('implementation');
    expect(describeWorkItemSummary(workflow)).toBe('3 open / 5 total, 1 live stage');
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

  it('treats standard workflows as the default active type', () => {
    const workflow = {
      id: 'workflow-1',
      name: 'Standard Flow',
      status: 'running',
      created_at: '2026-03-11',
      current_stage: 'review',
      task_counts: { completed: 2, running: 1 },
    };

    expect(describeWorkflowType(workflow)).toBe('Milestone board');
    expect(describeWorkflowStage(workflow)).toBe('review');
    expect(describeWorkItemSummary(workflow)).toBe('No work items');
    expect(formatTaskProgress(workflow.task_counts)).toBe('2/3');
    expect(resolveStatus(workflow)).toBe('planned');
    expect(resolveTypeFilter(workflow)).toBe('standard');
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
    ).toBe('Delivery complete');

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
    ).toBe('Delivery cancelled');

    expect(
      describeOperatorSignal({
        id: 'workflow-7',
        name: 'Failed',
        status: 'failed',
        created_at: '2026-03-11',
      }),
    ).toBe('Delivery blocked by failure');
  });
});
