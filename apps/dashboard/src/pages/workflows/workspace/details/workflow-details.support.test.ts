import { describe, expect, it } from 'vitest';

import type {
  DashboardMissionControlWorkflowCard,
  DashboardWorkflowBoardResponse,
  DashboardWorkflowInputPacketRecord,
  DashboardWorkflowStickyStrip,
  DashboardWorkflowWorkItemRecord,
} from '../../../../lib/api.js';
import type { WorkflowWorkbenchScopeDescriptor } from '../../workflows-page.support.js';
import {
  buildDetailsScope,
  buildWhatExistsNow,
} from './workflow-details.support.js';

describe('workflow-details support', () => {
  it('builds compact task rows and work-item files for selected work-item scope', () => {
    const result = buildWhatExistsNow({
      isWorkflowScope: false,
      board: createBoard(),
      selectedWorkItemTasks: [
        { id: 'task-1', title: 'Verify deliverable', state: 'in_progress', role: 'reviewer' },
        { id: 'task-2', title: 'Rollback validation', state: 'blocked', role: 'operator' },
      ],
      workflowPackets: [createPackets()[0]],
      workItemPackets: [createPackets()[1]],
    });

    expect(result.rows).toEqual([
      {
        id: 'task-1',
        title: 'Verify deliverable',
        subtitle: 'Reviewer',
        status: 'In Progress',
      },
      {
        id: 'task-2',
        title: 'Rollback validation',
        subtitle: 'Operator',
        status: 'Blocked',
      },
    ]);
    expect(result.files.map((file) => file.file_name)).toEqual(['rollback.md']);
  });

  it('builds workflow-scope rows from board work items and keeps workflow attachments deduplicated', () => {
    const board = createBoard();
    const duplicatedWorkflowPacket = {
      ...createPackets()[0],
      id: 'packet-1-duplicate',
    };

    const result = buildWhatExistsNow({
      isWorkflowScope: true,
      board,
      selectedWorkItemTasks: [],
      workflowPackets: [createPackets()[0], duplicatedWorkflowPacket],
      workItemPackets: [createPackets()[1]],
    });

    expect(result.rows).toEqual([
      {
        id: 'work-item-1',
        title: 'Prepare release bundle',
        subtitle: 'Release stage • Drafting lane',
        status: 'High',
      },
    ]);
    expect(result.files.map((file) => file.id)).toEqual(['file-1']);
  });

  it('keeps workflow names only on selected work-item scope summaries', () => {
    const selectedScope = buildDetailsScope({
      workflow: createWorkflow(),
      stickyStrip: createStickyStrip(),
      selectedWorkItemTitle: 'Prepare release bundle',
      selectedWorkItem: createWorkItem(),
      selectedWorkItemTasks: [
        { id: 'task-1', title: 'Verify deliverable', state: 'blocked' },
      ],
      scope: createScope('selected_work_item', 'Prepare release bundle'),
    });
    const workflowScope = buildDetailsScope({
      workflow: createWorkflow(),
      stickyStrip: createStickyStrip(),
      selectedWorkItemTitle: null,
      selectedWorkItem: null,
      selectedWorkItemTasks: [],
      scope: createScope('workflow', 'Release Workflow'),
    });

    expect(selectedScope.workflowName).toBe('Release Workflow');
    expect(workflowScope.workflowName).toBeNull();
  });
});

function createScope(
  scopeKind: WorkflowWorkbenchScopeDescriptor['scopeKind'],
  name: string,
): WorkflowWorkbenchScopeDescriptor {
  if (scopeKind === 'workflow') {
    return {
      scopeKind,
      title: 'Workflow',
      subject: 'workflow',
      name,
      banner: `Workflow: ${name}`,
    };
  }

  return {
    scopeKind,
    title: 'Work item',
    subject: 'work item',
    name,
    banner: `Work item: ${name}`,
  };
}

function createWorkflow(): DashboardMissionControlWorkflowCard {
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
    availableActions: [],
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
  };
}

function createStickyStrip(): DashboardWorkflowStickyStrip {
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
  };
}

function createBoard(): DashboardWorkflowBoardResponse {
  return {
    columns: [
      { id: 'drafting', label: 'Drafting' },
      { id: 'review', label: 'Review' },
    ],
    work_items: [createWorkItem()],
    active_stages: ['release'],
    awaiting_gate_count: 0,
    stage_summary: [],
  };
}

function createWorkItem(): DashboardWorkflowWorkItemRecord {
  return {
    id: 'work-item-1',
    workflow_id: 'workflow-1',
    stage_name: 'release',
    title: 'Prepare release bundle',
    goal: 'Confirm the final release packet is complete and operator-ready.',
    column_id: 'drafting',
    priority: 'high',
  };
}

function createPackets(): DashboardWorkflowInputPacketRecord[] {
  return [
    {
      id: 'packet-1',
      packet_kind: 'launch_inputs',
      summary: 'Launch inputs',
      work_item_id: null,
      structured_inputs: {
        operator_goal: 'Prepare the release bundle',
        target_environment: 'production',
      },
      files: [
        {
          id: 'file-1',
          file_name: 'launch-summary.pdf',
          download_url: '/files/launch-summary.pdf',
        },
      ],
    },
    {
      id: 'packet-2',
      packet_kind: 'rollback_plan',
      summary: 'Rollback plan',
      work_item_id: 'work-item-1',
      structured_inputs: {},
      files: [
        {
          id: 'file-2',
          file_name: 'rollback.md',
          download_url: '/files/rollback.md',
        },
      ],
    },
  ] as DashboardWorkflowInputPacketRecord[];
}
