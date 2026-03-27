import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import type {
  DashboardMissionControlActionAvailability,
  DashboardMissionControlOutputDescriptor,
  DashboardMissionControlPacket,
  DashboardMissionControlReadModelVersion,
  DashboardMissionControlWorkflowCard,
  DashboardMissionControlWorkspaceResponse,
} from '../../lib/api.js';
import { MissionControlWorkspacePane } from './mission-control-workspace-pane.js';

const VERSION: DashboardMissionControlReadModelVersion = {
  generatedAt: '2026-03-27T05:00:00.000Z',
  latestEventId: 42,
  token: 'mission-control:test',
};

describe('mission control workspace pane', () => {
  it('frames a selected workflow with quick links, controls, overview tabs, and mobile takeover copy', () => {
    const client = new QueryClient();
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/mission-control']}>
          <MissionControlWorkspacePane
            workflowId="workflow-1"
            response={buildWorkspaceResponse()}
            isLoading={false}
            initialTab="overview"
            isMobileTakeover
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(markup).toContain('Release Readiness');
    expect(markup).toContain('Waiting on launch approval');
    expect(markup).toContain('Overview');
    expect(markup).toContain('Board');
    expect(markup).toContain('Outputs');
    expect(markup).toContain('Steering');
    expect(markup).toContain('History');
    expect(markup).toContain('Return to live shell');
    expect(markup).toContain('Open full workflow');
    expect(markup).toContain('Open inspector');
    expect(markup).toContain('Pause');
    expect(markup).toContain('Cancel');
  });

  it('shows a loading shell before workflow workspace data arrives', () => {
    const client = new QueryClient();
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/mission-control']}>
          <MissionControlWorkspacePane
            workflowId="workflow-1"
            response={null}
            isLoading
            initialTab="overview"
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(markup).toContain('Loading workflow workspace');
  });

  it('declares query hooks before any loading or unavailable early return blocks', () => {
    const source = readFileSync(resolve(import.meta.dirname, './mission-control-workspace-pane.tsx'), 'utf8');
    expect(source.indexOf('const steeringSessionsQuery = useQuery')).toBeLessThan(source.indexOf('if (!props.workflowId)'));
    expect(source.indexOf('const steeringSessionsQuery = useQuery')).toBeLessThan(source.indexOf('if (props.isLoading)'));
    expect(source.indexOf('const steeringSessionsQuery = useQuery')).toBeLessThan(
      source.indexOf('if (!props.response?.workflow || !props.response.overview)'),
    );
  });
});

function buildWorkspaceResponse(): DashboardMissionControlWorkspaceResponse {
  const latestOutput = buildOutputDescriptor();
  return {
    version: VERSION,
    workflow: buildWorkflowCard(latestOutput),
    overview: {
      currentOperatorAsk: 'Waiting on launch approval',
      latestOutput,
      inputSummary: {
        parameterCount: 2,
        parameterKeys: ['objective', 'release_train'],
        contextKeys: ['attempt_reason'],
      },
      relationSummary: {
        child_status_counts: {
          total: 1,
          completed: 0,
        },
      },
      riskSummary: {
        blockedWorkItemCount: 1,
        openEscalationCount: 1,
        failedTaskCount: 0,
        recoverableIssueCount: 1,
      },
    },
    board: {
      columns: [
        { id: 'planned', label: 'Planned' },
        { id: 'in_progress', label: 'In Progress' },
        { id: 'blocked', label: 'Blocked', is_blocked: true },
      ],
      work_items: [
        {
          id: 'work-item-1',
          workflow_id: 'workflow-1',
          stage_name: 'validation',
          title: 'Launch package review',
          column_id: 'in_progress',
          owner_role: 'reviewer',
          next_expected_actor: 'Operator',
          next_expected_action: 'Approve launch gate',
          blocked_state: null,
          blocked_reason: null,
          escalation_status: 'open',
          gate_status: 'awaiting_approval',
          priority: 'high',
          task_count: 2,
          children_count: 1,
        },
      ],
      active_stages: ['validation'],
      awaiting_gate_count: 1,
      stage_summary: [
        {
          name: 'validation',
          goal: 'Validate the launch packet',
          status: 'in_progress',
          is_active: true,
          gate_status: 'awaiting_approval',
          work_item_count: 1,
          open_work_item_count: 1,
          completed_count: 0,
        },
      ],
    },
    outputs: {
      deliverables: [latestOutput],
      feed: [buildPacket('packet-output', 'output', 'Release brief updated', false)],
    },
    steering: {
      availableActions: buildAvailableActions(),
      interventionHistory: [buildPacket('packet-decision', 'decision', 'Launch gate approved', true)],
    },
    history: {
      packets: [
        buildPacket('packet-decision', 'decision', 'Launch gate approved', true),
        buildPacket('packet-progress', 'progress', 'Reviewer completed checklist', false),
      ],
    },
  };
}

function buildWorkflowCard(
  latestOutput: DashboardMissionControlOutputDescriptor,
): DashboardMissionControlWorkflowCard {
  return {
    id: 'workflow-1',
    name: 'Release Readiness',
    state: 'active',
    lifecycle: 'continuous',
    currentStage: 'validation',
    workspaceId: 'workspace-1',
    workspaceName: 'Shipping Workspace',
    playbookId: 'playbook-1',
    playbookName: 'Release Readiness',
    posture: 'needs_decision',
    attentionLane: 'needs_decision',
    pulse: {
      summary: 'Waiting on launch approval',
      tone: 'warning',
      updatedAt: '2026-03-27T05:00:00.000Z',
    },
    outputDescriptors: [latestOutput],
    availableActions: buildAvailableActions(),
    metrics: {
      activeTaskCount: 2,
      activeWorkItemCount: 1,
      blockedWorkItemCount: 1,
      openEscalationCount: 1,
      waitingForDecisionCount: 1,
      failedTaskCount: 0,
      recoverableIssueCount: 1,
      lastChangedAt: '2026-03-27T05:00:00.000Z',
    },
    version: VERSION,
  };
}

function buildAvailableActions(): DashboardMissionControlActionAvailability[] {
  return [
    {
      kind: 'pause_workflow',
      scope: 'workflow',
      enabled: true,
      confirmationLevel: 'immediate',
      stale: false,
      disabledReason: null,
    },
    {
      kind: 'cancel_workflow',
      scope: 'workflow',
      enabled: true,
      confirmationLevel: 'high_impact_confirm',
      stale: false,
      disabledReason: null,
    },
  ];
}

function buildOutputDescriptor(): DashboardMissionControlOutputDescriptor {
  return {
    id: 'output-1',
    title: 'Release brief',
    summary: 'Updated with launch-readiness callouts.',
    status: 'under_review',
    producedByRole: 'reviewer',
    workItemId: 'work-item-1',
    taskId: 'task-1',
    stageName: 'validation',
    primaryLocation: {
      kind: 'artifact',
      artifactId: 'artifact-1',
      taskId: 'task-1',
      logicalPath: 'artifacts/release-brief.md',
      previewPath: '/artifacts/artifact-1/preview',
      downloadPath: '/artifacts/artifact-1/download',
      contentType: 'text/markdown',
    },
    secondaryLocations: [],
  };
}

function buildPacket(
  id: string,
  category: DashboardMissionControlPacket['category'],
  title: string,
  carryover: boolean,
): DashboardMissionControlPacket {
  return {
    id,
    workflowId: 'workflow-1',
    workflowName: 'Release Readiness',
    posture: 'needs_decision',
    category,
    title,
    summary: `${title} summary`,
    changedAt: '2026-03-27T05:00:00.000Z',
    carryover,
    outputDescriptors: [buildOutputDescriptor()],
  };
}
