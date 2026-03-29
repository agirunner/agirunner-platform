import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type {
  DashboardMissionControlWorkflowCard,
  DashboardTaskRecord,
  DashboardWorkflowBoardResponse,
  DashboardWorkflowInputPacketRecord,
  DashboardWorkflowStickyStrip,
  DashboardWorkflowWorkItemRecord,
} from '../../../lib/api.js';
import { WorkflowDetails } from './workflow-details.js';

describe('WorkflowDetails', () => {
  it('renders task scope with workflow/work-item context and filters internal task metadata out of operator inputs', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDetails, {
        workflow: createWorkflow(),
        stickyStrip: createStickyStrip(),
        board: createBoard(),
        selectedWorkItemId: 'work-item-1',
        selectedWorkItemTitle: 'Prepare release bundle',
        selectedTaskId: 'task-1',
        selectedTaskTitle: 'Verify deliverable',
        selectedWorkItem: createWorkItem(),
        selectedTask: {
          ...createTask(),
          input: {
            artifact_id: 'artifact-1',
            deliverable: 'A full policy assessment handoff with readiness decision, evidence, and rework guidance.',
            work_item_id: 'work-item-1',
            subject_task_id: 'task-source-1',
            subject_revision: 1,
          },
        },
        selectedWorkItemTasks: [
          {
            id: 'task-1',
            title: 'Verify deliverable',
            role: 'reviewer',
            state: 'in_progress',
          },
        ],
        inputPackets: createPackets(),
        workflowParameters: {
          branch: 'release/2026.03',
          release_window: 'Friday 17:00',
        },
        scope: {
          scopeKind: 'selected_task',
          title: 'Task',
          subject: 'task',
          name: 'Verify deliverable',
          banner: 'Task: Verify deliverable',
        },
      }),
    );

    expect(html).toContain('Verify deliverable');
    expect(html).toContain('Task');
    expect(html).toContain('In Progress for Reviewer');
    expect(html).toContain('Workflow: Release Workflow');
    expect(html).toContain('Work item: Prepare release bundle');
    expect(html).toContain('Rollback guide');
    expect(html).toContain('rollback.md');
    expect(html).toContain('Task input');
    expect(html).toContain('Inputs');
    expect(html).toContain('Deliverable');
    expect(html).toContain('A full policy assessment handoff with readiness decision, evidence, and rework guidance.');
    expect(html).not.toContain('Artifact Id');
    expect(html).not.toContain('artifact-1');
    expect(html).not.toContain('Work Item Id');
    expect(html).not.toContain('Subject Task Id');
    expect(html).not.toContain('Subject Revision');
    expect(html).not.toContain('Task scope');
    expect(html).not.toContain('Latest status');
    expect(html).not.toContain('Work item scope');
    expect(html).not.toContain('Workflow scope');
    expect(html).not.toContain('Launch packet');
    expect(html).not.toContain('release/2026.03');
    expect(html).not.toContain('Launch • Operator');
    expect(html).not.toContain('Owner role');
    expect(html).not.toContain('Next expected actor');
    expect(html).not.toContain('Next expected action');
    expect(html).not.toContain('Backend');
    expect(html).not.toContain('Started');
    expect(html).not.toContain('Updated');
    expect(html).not.toContain('Workflow details');
    expect(html).not.toContain('Work item details');
    expect(html).not.toContain('Playbook');
    expect(html).not.toContain('Workspace');
    expect(html).not.toContain('Stage');
    expect(html).not.toContain('Lane');
    expect(html).not.toContain('Related tasks');
    expect(html).not.toContain('rounded-lg border border-border/60 bg-muted/5 p-3');
    expect(html).not.toContain('rounded-xl border border-border/70 bg-background/70');
  });

  it('shows one compact task summary line for work-item scope instead of a full related-task list', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDetails, {
        workflow: createWorkflow(),
        stickyStrip: createStickyStrip(),
        board: createBoard(),
        selectedWorkItemId: 'work-item-1',
        selectedWorkItemTitle: 'Prepare release bundle',
        selectedTaskId: null,
        selectedTaskTitle: null,
        selectedWorkItem: createWorkItem(),
        selectedTask: null,
        selectedWorkItemTasks: [
          { id: 'task-1', title: 'Verify deliverable', state: 'in_progress' },
          { id: 'task-2', title: 'Rollback validation', state: 'blocked' },
          { id: 'task-3', title: 'Archive release notes', state: 'completed' },
        ],
        inputPackets: createPackets(),
        workflowParameters: null,
        scope: {
          scopeKind: 'selected_work_item',
          title: 'Work item',
          subject: 'work item',
          name: 'Prepare release bundle',
          banner: 'Work item: Prepare release bundle',
        },
      }),
    );

    expect(html).toContain('Work item');
    expect(html).toContain('1 active');
    expect(html).toContain('1 blocked');
    expect(html).toContain('1 completed');
    expect(html).not.toContain('Work item scope');
    expect(html).not.toContain('Latest status');
    expect(html).not.toContain('Tasks</span>');
    expect(html).not.toContain('Current task load:');
    expect(html).not.toContain('Verify deliverable</span>');
    expect(html).not.toContain('Rollback validation</span>');
    expect(html).not.toContain('Archive release notes</span>');
    expect(html).not.toContain('Related tasks');
  });

  it('shows workflow launch inputs without leaking work-item content', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDetails, {
        workflow: createWorkflow(),
        stickyStrip: createStickyStrip(),
        board: createBoard(),
        selectedWorkItemId: null,
        selectedWorkItemTitle: null,
        selectedTaskId: null,
        selectedTaskTitle: null,
        selectedWorkItem: null,
        selectedTask: null,
        selectedWorkItemTasks: [],
        inputPackets: createPackets(),
        workflowParameters: {
          branch: 'release/2026.03',
          release_window: 'Friday 17:00',
        },
        scope: {
          scopeKind: 'workflow',
          title: 'Workflow',
          subject: 'workflow',
          name: 'Release Workflow',
          banner: 'Workflow: Release Workflow',
        },
      }),
    );

    expect(html).toContain('Workflow');
    expect(html).toContain('Release bundle is being assembled.');
    expect(html).toContain('Launch inputs');
    expect(html).toContain('Launch packet');
    expect(html).toContain('release/2026.03');
    expect(html).not.toContain('Latest status');
    expect(html).not.toContain('Workflow scope');
    expect(html).not.toContain('Rollback guide');
    expect(html).not.toContain('rollback.md');
    expect(html).not.toContain('Task input');
  });

  it('keeps the selected task context compact by showing only the parent work item and task summary', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDetails, {
        workflow: createWorkflow(),
        stickyStrip: createStickyStrip(),
        board: createBoard(),
        selectedWorkItemId: 'work-item-1',
        selectedWorkItemTitle: 'Prepare release bundle',
        selectedTaskId: 'task-1',
        selectedTaskTitle: 'Verify deliverable',
        selectedWorkItem: createWorkItem(),
        selectedTask: createTask(),
        selectedWorkItemTasks: [],
        inputPackets: createPackets(),
        workflowParameters: null,
        scope: {
          scopeKind: 'selected_task',
          title: 'Task',
          subject: 'task',
          name: 'Verify deliverable',
          banner: 'Task: Verify deliverable',
        },
      }),
    );

    expect(html).toContain('Prepare release bundle');
    expect(html).toContain('Check the final release packet and approve it.');
    expect(html).toContain('Workflow: Release Workflow');
    expect(html).toContain('Work item: Prepare release bundle');
    expect(html).not.toContain('Task scope');
    expect(html).not.toContain('Owner role');
    expect(html).not.toContain('Next expected actor');
  });

  it('fills thin task scope with parent work-item inputs instead of showing an empty task-only pane', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDetails, {
        workflow: createWorkflow(),
        stickyStrip: createStickyStrip(),
        board: createBoard(),
        selectedWorkItemId: 'work-item-1',
        selectedWorkItemTitle: 'Prepare release bundle',
        selectedTaskId: 'task-1',
        selectedTaskTitle: 'Verify deliverable',
        selectedWorkItem: createWorkItem(),
        selectedTask: {
          ...createTask(),
          input: {},
        },
        selectedWorkItemTasks: [],
        inputPackets: createPackets(),
        workflowParameters: null,
        scope: {
          scopeKind: 'selected_task',
          title: 'Task',
          subject: 'task',
          name: 'Verify deliverable',
          banner: 'Task: Verify deliverable',
        },
      }),
    );

    expect(html).toContain('Inputs');
    expect(html).toContain('Rollback guide');
    expect(html).toContain('rollback.md');
    expect(html).not.toContain('Launch packet');
    expect(html).not.toContain('Task input');
  });

  it('keeps scoped work-item packets visible before the selected work-item record finishes loading', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDetails, {
        workflow: createWorkflow(),
        stickyStrip: createStickyStrip(),
        board: createBoard(),
        selectedWorkItemId: 'work-item-1',
        selectedWorkItemTitle: 'Prepare release bundle',
        selectedTaskId: null,
        selectedTaskTitle: null,
        selectedWorkItem: null,
        selectedTask: null,
        selectedWorkItemTasks: [],
        inputPackets: createPackets(),
        workflowParameters: null,
        scope: {
          scopeKind: 'selected_work_item',
          title: 'Work item',
          subject: 'work item',
          name: 'Prepare release bundle',
          banner: 'Work item: Prepare release bundle',
        },
      }),
    );

    expect(html).toContain('Inputs');
    expect(html).toContain('Rollback guide');
    expect(html).toContain('rollback.md');
    expect(html).not.toContain('Workflow inputs');
  });

  it('omits the inputs section when the current scope has no operator-facing inputs yet', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDetails, {
        workflow: createWorkflow(),
        stickyStrip: createStickyStrip(),
        board: createBoard(),
        selectedWorkItemId: null,
        selectedWorkItemTitle: null,
        selectedTaskId: null,
        selectedTaskTitle: null,
        selectedWorkItem: null,
        selectedTask: null,
        selectedWorkItemTasks: [],
        inputPackets: [],
        workflowParameters: null,
        scope: {
          scopeKind: 'workflow',
          title: 'Workflow',
          subject: 'workflow',
          name: 'Release Workflow',
          banner: 'Workflow: Release Workflow',
        },
      }),
    );

    expect(html).toContain('Workflow');
    expect(html).not.toContain('Inputs');
    expect(html).not.toContain('Workflow parameters');
    expect(html).not.toContain('Work item inputs');
    expect(html).not.toContain('Task input');
  });
});

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
    goal: 'Assemble final artifacts for launch.',
    acceptance_criteria: 'Release notes and approval summary are attached.',
    column_id: 'review',
    owner_role: 'release_manager',
    next_expected_actor: 'reviewer',
    next_expected_action: 'Approve release packet',
    priority: 'high',
    task_count: 4,
  };
}

function createTask(): DashboardTaskRecord {
  return {
    id: 'task-1',
    tenant_id: 'tenant-1',
    workflow_id: 'workflow-1',
    workspace_id: 'workspace-1',
    parent_id: null,
    title: 'Verify deliverable',
    description: 'Check the final release packet and approve it.',
    state: 'in_progress',
    priority: 'high',
    execution_backend: 'runtime_plus_task',
    used_task_sandbox: true,
    role: 'reviewer',
    role_config: {},
    environment: {},
    resource_bindings: [],
    input: {
      checklist: ['release-notes', 'artifacts'],
    },
    output: null,
    metadata: {},
    assigned_agent_id: null,
    assigned_worker_id: null,
    depends_on: [],
    timeout_minutes: 30,
    auto_retry: false,
    max_retries: 0,
    retry_count: 0,
    claimed_at: null,
    started_at: '2026-03-27T23:40:00.000Z',
    completed_at: null,
    failed_at: null,
    cancelled_at: null,
    created_at: '2026-03-27T23:35:00.000Z',
    updated_at: '2026-03-27T23:50:00.000Z',
    workflow: {
      id: 'workflow-1',
      name: 'Release Workflow',
      workspace_id: 'workspace-1',
    },
    workflow_name: 'Release Workflow',
    workspace_name: 'Launch Workspace',
    work_item_id: 'work-item-1',
    work_item_title: 'Prepare release bundle',
    stage_name: 'release',
    activation_id: 'activation-1',
    execution_environment: null,
  };
}

function createPackets(): DashboardWorkflowInputPacketRecord[] {
  return [
    {
      id: 'packet-1',
      workflow_id: 'workflow-1',
      work_item_id: null,
      packet_kind: 'launch',
      source: 'operator',
      summary: 'Launch packet',
      structured_inputs: {
        release: '2026.03',
      },
      metadata: {},
      created_by_type: 'user',
      created_by_id: 'user-1',
      created_at: '2026-03-27T23:30:00.000Z',
      updated_at: '2026-03-27T23:30:00.000Z',
      files: [],
    },
    {
      id: 'packet-2',
      workflow_id: 'workflow-1',
      work_item_id: 'work-item-1',
      packet_kind: 'intake',
      source: 'operator',
      summary: 'Rollback guide',
      structured_inputs: {
        path: 'docs/rollback.md',
      },
      metadata: {},
      created_by_type: 'user',
      created_by_id: 'user-1',
      created_at: '2026-03-27T23:31:00.000Z',
      updated_at: '2026-03-27T23:31:00.000Z',
      files: [
        {
          id: 'file-1',
          file_name: 'rollback.md',
          description: null,
          content_type: 'text/markdown',
          size_bytes: 512,
          created_at: '2026-03-27T23:31:00.000Z',
          download_url: '/files/rollback.md',
        },
      ],
    },
  ];
}
