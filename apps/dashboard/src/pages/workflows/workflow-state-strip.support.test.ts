import { describe, expect, it } from 'vitest';

import type {
  DashboardMissionControlWorkflowCard,
  DashboardWorkflowBoardResponse,
  DashboardWorkflowStickyStrip,
} from '../../lib/api.js';
import {
  buildWorkflowHeaderState,
  buildFallbackWorkflowActions,
  formatNeedsActionDetail,
  summarizeWorkload,
} from './workflow-state-strip.support.js';

describe('workflow-state-strip support', () => {
  it('counts only unresolved approvals and escalations in the needs-action detail', () => {
    expect(
      formatNeedsActionDetail({
        approvals_count: 1,
        escalations_count: 1,
      } as DashboardWorkflowStickyStrip),
    ).toBe('1 approval • 1 escalation');
  });

  it('keeps workload counts aligned to the board when completed work is projected into terminal lanes', () => {
    expect(summarizeWorkload(createBoard(), createWorkflowCard())).toEqual({
      activeWorkItemCount: 1,
      completedWorkItemCount: 2,
    });
  });

  it('synthesizes pause and cancel as the active fallback workflow actions', () => {
    expect(buildFallbackWorkflowActions('active')).toEqual([
      expect.objectContaining({ kind: 'pause_workflow', scope: 'workflow', enabled: true }),
      expect.objectContaining({ kind: 'cancel_workflow', scope: 'workflow', enabled: true }),
    ]);
  });

  it('builds the current header state from workflow posture, actions, and sticky metrics', () => {
    const headerState = buildWorkflowHeaderState({
      workflow: createWorkflowCard(),
      stickyStrip: {
        ...createStickyStrip(),
        approvals_count: 1,
        escalations_count: 1,
        active_task_count: 3,
      },
      board: createBoard(),
      addWorkLabel: null,
    });

    expect(headerState.postureLabel).toBe('Progressing');
    expect(headerState.updatedLabel).toContain('Updated');
    expect(headerState.canAddWork).toBe(true);
    expect(headerState.needsActionCount).toBe(2);
    expect(headerState.addWorkLabel).toBe('Add Work');
    expect(headerState.activeSpecialistTaskCount).toBe(3);
    expect(headerState.workload).toEqual({
      activeWorkItemCount: 1,
      completedWorkItemCount: 2,
    });
  });
});

function createWorkflowCard(
  overrides: Partial<DashboardMissionControlWorkflowCard> = {},
): DashboardMissionControlWorkflowCard {
  return {
    id: 'workflow-1',
    name: 'Release Workflow',
    state: 'active',
    lifecycle: 'planned',
    currentStage: 'release',
    workspaceId: 'workspace-1',
    workspaceName: 'Launch Workspace',
    playbookId: 'playbook-1',
    playbookName: 'Release Playbook',
    posture: 'progressing',
    attentionLane: 'watchlist',
    pulse: {
      summary: 'Workflow is preparing the release bundle.',
      tone: 'progressing',
      updatedAt: '2026-03-27T23:50:00.000Z',
    },
    outputDescriptors: [],
    availableActions: [
      {
        kind: 'pause_workflow',
        scope: 'workflow',
        enabled: true,
        confirmationLevel: 'immediate',
        stale: false,
        disabledReason: null,
      },
      {
        kind: 'add_work_item',
        scope: 'workflow',
        enabled: true,
        confirmationLevel: 'immediate',
        stale: false,
        disabledReason: null,
      },
    ],
    metrics: {
      activeTaskCount: 2,
      activeWorkItemCount: 1,
      blockedWorkItemCount: 0,
      openEscalationCount: 0,
      waitingForDecisionCount: 0,
      failedTaskCount: 0,
      recoverableIssueCount: 0,
      lastChangedAt: '2026-03-27T23:50:00.000Z',
    },
    version: {
      generatedAt: '2026-03-27T23:50:00.000Z',
      latestEventId: 1,
      token: 'workflow-operations:1',
    },
    ...overrides,
  };
}

function createStickyStrip(
  overrides: Partial<DashboardWorkflowStickyStrip> = {},
): DashboardWorkflowStickyStrip {
  return {
    workflow_id: 'workflow-1',
    workflow_name: 'Release Workflow',
    posture: 'progressing',
    summary: 'Release bundle is being assembled.',
    approvals_count: 0,
    escalations_count: 0,
    blocked_work_item_count: 0,
    active_task_count: 2,
    active_work_item_count: 1,
    steering_available: true,
    ...overrides,
  };
}

function createBoard(): DashboardWorkflowBoardResponse {
  return {
    columns: [
      { id: 'drafting', label: 'Drafting' },
      { id: 'done', label: 'Done', is_terminal: true },
    ],
    work_items: [
      {
        id: 'work-item-1',
        workflow_id: 'workflow-1',
        stage_name: 'release',
        title: 'Prepare release bundle',
        goal: 'Assemble final artifacts for launch.',
        column_id: 'drafting',
        priority: 'normal',
      },
      {
        id: 'work-item-2',
        workflow_id: 'workflow-1',
        stage_name: 'release',
        title: 'Publish launch notes',
        goal: 'Ship the release notes.',
        column_id: 'done',
        priority: 'medium',
        completed_at: '2026-03-27T23:50:00.000Z',
      },
      {
        id: 'work-item-3',
        workflow_id: 'workflow-1',
        stage_name: 'release',
        title: 'Archive evidence',
        goal: 'Archive the launch evidence.',
        column_id: 'done',
        priority: 'low',
        completed_at: '2026-03-28T00:00:00.000Z',
      },
    ],
    active_stages: ['release'],
    awaiting_gate_count: 0,
    stage_summary: [],
  };
}
