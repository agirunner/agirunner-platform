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
  it('keeps stale task-scoped data framed as selected work-item details', () => {
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
        scope: createScope('selected_task', 'Verify deliverable'),
      }),
    );

    expect(html).toContain(
      '<h3 class="text-base font-semibold text-foreground">Prepare release bundle</h3>',
    );
    expect(html).toContain('Basics');
    expect(html).toContain('Workflow');
    expect(html).toContain('Release Workflow');
    expect(html).not.toContain(
      '<h3 class="text-base font-semibold text-foreground">Verify deliverable</h3>',
    );
    expect(html).not.toContain('Task input');
    expect(html).not.toContain('Task');
    expect(html).not.toContain('Work item scope');
    expect(html).not.toContain('Task scope');
  });

  it('shows latest task context as work-item input context without leaking internal fields', () => {
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
            deliverable:
              'A full policy assessment handoff with readiness decision, evidence, and rework guidance.',
            work_item_id: 'work-item-1',
            subject_task_id: 'task-source-1',
            subject_revision: 1,
          },
        },
        selectedWorkItemTasks: [],
        inputPackets: createPackets(),
        workflowParameters: null,
        scope: createScope('selected_task', 'Verify deliverable'),
      }),
    );

    expect(html).toContain('Inputs');
    expect(html).toContain('Latest task context');
    expect(html).toContain('Requested deliverable');
    expect(html).toContain(
      'A full policy assessment handoff with readiness decision, evidence, and rework guidance.',
    );
    expect(html).not.toContain('Task input');
    expect(html).not.toContain('Artifact Id');
    expect(html).not.toContain('artifact-1');
    expect(html).not.toContain('Work Item Id');
    expect(html).not.toContain('Subject Task Id');
    expect(html).not.toContain('Subject Revision');
  });

  it('keeps selected work-item details concrete with the latest status and task rows only', () => {
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
        scope: createScope('selected_work_item', 'Prepare release bundle'),
      }),
    );

    expect(html).toContain('Prepare release bundle');
    expect(html).toContain('Assemble final artifacts for launch.');
    expect(html).toContain('1 blocked task');
    expect(html).toContain('Verify deliverable');
    expect(html).toContain('In Progress');
    expect(html).toContain('Rollback validation');
    expect(html).toContain('Blocked');
    expect(html).toContain('Archive release notes');
    expect(html).toContain('Completed');
    expect(html).not.toContain('1 active');
    expect(html).not.toContain('1 completed');
    expect(html).not.toContain('1 active • 1 blocked • 1 completed');
    expect(html).not.toContain('Related tasks');
  });

  it('keeps workflow scope minimal and limited to workflow-level inputs', () => {
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
        scope: createScope('workflow', 'Release Workflow'),
      }),
    );

    expect(html).toContain('Release Workflow');
    expect(html).toContain('Release bundle is being assembled.');
    expect(html).toContain('Launch inputs');
    expect(html).toContain('Launch packet');
    expect(html).toContain('release/2026.03');
    expect(html).not.toContain('Prepare release bundle');
    expect(html).not.toContain('Rollback guide');
    expect(html).not.toContain('rollback.md');
    expect(html).not.toContain('Latest task context');
    expect(html).not.toContain('Task input');
  });
});

function createScope(
  scopeKind: 'workflow' | 'selected_work_item' | 'selected_task',
  name: string,
) {
  if (scopeKind === 'workflow') {
    return {
      scopeKind,
      title: 'Workflow' as const,
      subject: 'workflow' as const,
      name,
      banner: `Workflow: ${name}`,
    };
  }

  return {
    scopeKind,
    title: scopeKind === 'selected_work_item' ? ('Work item' as const) : ('Task' as const),
    subject: scopeKind === 'selected_work_item' ? ('work item' as const) : ('task' as const),
    name,
    banner:
      scopeKind === 'selected_work_item' ? `Work item: ${name}` : `Task: ${name}`,
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
