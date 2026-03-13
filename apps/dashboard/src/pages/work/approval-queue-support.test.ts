import { describe, expect, it } from 'vitest';

import {
  buildTaskApprovalBreadcrumbs,
  countPendingOrchestratorFollowUp,
  gateQueuePriorityVariant,
  readTaskOperatorFlowLabel,
  renderQueuePriorityLabel,
  summarizeFirstGate,
} from './approval-queue-support.js';

describe('approval queue support', () => {
  it('builds labeled task approval breadcrumbs with activation context', () => {
    expect(
      buildTaskApprovalBreadcrumbs({
        id: 'task-1',
        title: 'Review login copy',
        state: 'awaiting_approval',
        workflow_id: 'wf-1',
        workflow_name: 'Customer Onboarding',
        work_item_id: 'wi-1',
        work_item_title: 'Ship onboarding polish',
        stage_name: 'qa',
        role: 'reviewer',
        activation_id: 'activation-1',
        created_at: '2026-03-12T12:00:00.000Z',
      }),
    ).toEqual([
      'Board: Customer Onboarding',
      'Work item: Ship onboarding polish',
      'Stage: qa',
      'Role: reviewer',
      'Activation: activation-1',
    ]);
  });

  it('distinguishes grouped work-item flow from direct operator decisions', () => {
    expect(
      readTaskOperatorFlowLabel({
        id: 'task-1',
        title: 'Review login copy',
        state: 'awaiting_approval',
        workflow_id: 'wf-1',
        work_item_id: 'wi-1',
        created_at: '2026-03-12T12:00:00.000Z',
      }),
    ).toBe('Grouped work-item operator flow');
    expect(
      readTaskOperatorFlowLabel({
        id: 'task-stage',
        title: 'Review release readiness',
        state: 'awaiting_approval',
        workflow_id: 'wf-2',
        stage_name: 'qa',
        created_at: '2026-03-12T12:00:00.000Z',
      }),
    ).toBe('Stage/operator board flow');
    expect(
      readTaskOperatorFlowLabel({
        id: 'task-2',
        title: 'Review login copy',
        state: 'awaiting_approval',
        created_at: '2026-03-12T12:00:00.000Z',
      }),
    ).toBe('Direct operator decision');
  });

  it('summarizes the first stage gate with labeled breadcrumb depth', () => {
    expect(
      summarizeFirstGate([
        {
          id: 'legacy-1',
          gate_id: 'gate-1',
          workflow_id: 'wf-1',
          workflow_name: 'Customer Onboarding',
          stage_name: 'qa',
          stage_goal: 'Approve release',
          gate_status: 'awaiting_approval',
          concerns: [],
          key_artifacts: [],
          updated_at: '2026-03-12T12:00:00.000Z',
          requested_by_task: {
            id: 'task-1',
            title: 'Draft release notes',
            role: 'writer',
            work_item_title: 'Ship onboarding polish',
          },
        },
      ]),
    ).toBe('Board: Customer Onboarding • Stage: qa • Work item: Ship onboarding polish • Step: Draft release notes • writer');
  });

  it('counts only decided gates without visible orchestrator follow-up', () => {
    expect(
      countPendingOrchestratorFollowUp([
        {
          id: 'legacy-1',
          gate_id: 'gate-1',
          workflow_id: 'wf-1',
          workflow_name: 'Customer Onboarding',
          stage_name: 'qa',
          stage_goal: 'Approve release',
          gate_status: 'awaiting_approval',
          concerns: [],
          key_artifacts: [],
          updated_at: '2026-03-12T12:00:00.000Z',
          human_decision: { action: 'approve' },
        },
        {
          id: 'legacy-2',
          gate_id: 'gate-2',
          workflow_id: 'wf-1',
          workflow_name: 'Customer Onboarding',
          stage_name: 'build',
          stage_goal: 'Approve build',
          gate_status: 'awaiting_approval',
          concerns: [],
          key_artifacts: [],
          updated_at: '2026-03-12T12:10:00.000Z',
          human_decision: { action: 'approve' },
          orchestrator_resume: { activation_id: 'activation-1', state: 'queued' },
        },
      ]),
    ).toBe(1);
  });

  it('maps gate queue priority labels and badge variants by oldest-first order', () => {
    expect(gateQueuePriorityVariant(0)).toBe('destructive');
    expect(gateQueuePriorityVariant(1)).toBe('warning');
    expect(gateQueuePriorityVariant(4)).toBe('outline');
    expect(renderQueuePriorityLabel(0)).toBe('Queue priority 1');
    expect(renderQueuePriorityLabel(3)).toBe('Queue priority 4');
  });
});
