import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type {
  DashboardMissionControlWorkflowCard,
  DashboardWorkflowBoardResponse,
  DashboardWorkflowInputPacketRecord,
  DashboardWorkflowStickyStrip,
  DashboardWorkflowWorkItemRecord,
} from '../../../lib/api.js';
import { WorkflowDetails } from './workflow-details.js';

describe('WorkflowDetails', () => {
  it('renders selected work-item scope as a compact briefing with readable asks and task rows', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDetails, {
        workflow: createWorkflow(),
        stickyStrip: createStickyStrip(),
        board: createBoard(),
        selectedWorkItemId: 'work-item-1',
        selectedWorkItemTitle: 'Prepare release bundle',
        selectedWorkItem: createWorkItem(),
        selectedWorkItemTasks: [
          {
            id: 'task-1',
            title: 'Verify deliverable',
            state: 'in_progress',
            input: {
              deliverable: 'Confirm the final release packet is complete and operator-ready.',
              checklist: ['release-notes', 'artifact-manifest'],
              repository_url: 'https://x-access-token:secret@example.com/org/repo.git',
              artifact_id: 'artifact-1',
              work_item_id: 'work-item-1',
              subject_revision: 1,
            },
          },
          { id: 'task-2', title: 'Rollback validation', state: 'blocked' },
          { id: 'task-3', title: 'Archive release notes', state: 'completed' },
        ],
        inputPackets: createPackets(),
        workflowParameters: null,
        scope: createScope('selected_work_item', 'Prepare release bundle'),
      }),
    );

    expect(html).toContain('1 blocked task');
    expect(html).toContain('What was asked');
    expect(html).toContain('Current state');
    expect(html).toContain('What exists now');
    expect(html).toContain('Input attachments');
    expect(html).toContain('Confirm the final release packet is complete and operator-ready.');
    expect(html).toContain('Release Notes');
    expect(html).toContain('Artifact Manifest');
    expect(html).toContain('https://example.com/org/repo.git');
    expect(html).toContain('Verify deliverable');
    expect(html).toContain('Rollback validation');
    expect(html).toContain('Archive release notes');
    expect(html).toContain('rollback.md');
    expect(html).not.toContain('launch-summary.pdf');
    expect(html).not.toContain(
      '<p class="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Release Workflow</p>',
    );
    expect(html).not.toContain('Basics');
    expect(html).not.toContain('Inputs');
    expect(html).not.toContain('Tasks');
    expect(html).not.toContain('Current task input');
    expect(html).not.toContain('Artifact Id');
    expect(html).not.toContain('artifact-1');
    expect(html).not.toContain('Subject Revision');
    expect(html).not.toContain('Work Item Id');
    expect(html).not.toContain('Work item · Prepare release bundle');
    expect(html).not.toContain('Verify deliverable</h3>');
  });

  it('renders workflow scope with the same briefing sections and compact work-item rows', () => {
    const board: DashboardWorkflowBoardResponse = {
      columns: [
        { id: 'drafting', label: 'Drafting' },
        { id: 'review', label: 'Review' },
      ],
      work_items: [
        createWorkItem(),
        {
          ...createWorkItem(),
          id: 'work-item-2',
          title: 'Publish launch notes',
          goal: 'Publish the release notes and operator summary.',
          column_id: 'drafting',
          priority: 'medium',
          task_count: 2,
        },
      ],
      active_stages: ['release'],
      awaiting_gate_count: 0,
      stage_summary: [],
    };

    const html = renderToStaticMarkup(
      createElement(WorkflowDetails, {
        workflow: createWorkflow(),
        stickyStrip: createStickyStrip(),
        board,
        selectedWorkItemId: null,
        selectedWorkItemTitle: null,
        selectedWorkItem: null,
        selectedWorkItemTasks: [],
        inputPackets: createPackets(),
        workflowParameters: {
          branch: 'release/2026.03',
          release_window: 'Friday 17:00',
        },
        scope: createScope('workflow', 'Release Workflow'),
      }),
    );

    expect(html).toContain('Release bundle is being assembled.');
    expect(html).toContain('What was asked');
    expect(html).toContain('Current state');
    expect(html).toContain('What exists now');
    expect(html).toContain('Input attachments');
    expect(html).toContain('Active work items are currently in Release stage.');
    expect(html).toContain('release/2026.03');
    expect(html).toContain('Friday 17:00');
    expect(html).toContain('Prepare release bundle');
    expect(html).toContain('Publish launch notes');
    expect(html).toContain('launch-summary.pdf');
    expect(html).not.toContain('Basics');
    expect(html).not.toContain('Inputs');
    expect(html).not.toContain('Tasks');
    expect(html).not.toContain('Launch inputs');
    expect(html).not.toContain('Workflow state');
    expect(html).not.toContain('Verify deliverable');
  });
});

function createScope(
  scopeKind: 'workflow' | 'selected_work_item',
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
    title: 'Work item' as const,
    subject: 'work item' as const,
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
      files: [
        {
          id: 'file-0',
          file_name: 'launch-summary.pdf',
          description: null,
          content_type: 'application/pdf',
          size_bytes: 1024,
          created_at: '2026-03-27T23:30:00.000Z',
          download_url: '/files/launch-summary.pdf',
        },
      ],
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
