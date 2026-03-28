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
  it('renders a trimmed operator-facing scope sheet with real inputs', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDetails, {
        workflow: createWorkflow(),
        stickyStrip: createStickyStrip(),
        board: createBoard(),
        selectedWorkItem: createWorkItem(),
        selectedTask: createTask(),
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
      }),
    );

    expect(html).toContain('Task');
    expect(html).toContain('Verify deliverable');
    expect(html).toContain('Workflow inputs');
    expect(html).toContain('Workflow parameters');
    expect(html).toContain('Work item inputs');
    expect(html).toContain('Task input');
    expect(html).toContain('Rollback guide');
    expect(html).toContain('release/2026.03');
    expect(html).not.toContain('Owner role');
    expect(html).not.toContain('Next expected actor');
    expect(html).not.toContain('Next expected action');
    expect(html).not.toContain('Workflow details');
    expect(html).not.toContain('Work item details');
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
      files: [],
    },
  ];
}
