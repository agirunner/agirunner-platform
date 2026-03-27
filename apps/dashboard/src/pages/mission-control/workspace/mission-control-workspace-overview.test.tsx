import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type {
  DashboardMissionControlOutputDescriptor,
  DashboardMissionControlWorkflowCard,
  DashboardMissionControlWorkspaceOverview,
} from '../../../lib/api.js';
import { MissionControlWorkspaceOverview } from './mission-control-workspace-overview.js';

describe('mission control workspace overview', () => {
  it('renders current ask, output, input, relation, and risk packets for the selected workflow', () => {
    const output = buildOutputDescriptor();
    const markup = renderToStaticMarkup(
      <MissionControlWorkspaceOverview
        workflow={buildWorkflowCard(output)}
        overview={buildOverview(output)}
      />,
    );

    expect(markup).toContain('Current operator ask');
    expect(markup).toContain('Waiting on launch approval');
    expect(markup).toContain('Latest output');
    expect(markup).toContain('Release brief');
    expect(markup).toContain('Inputs');
    expect(markup).toContain('objective');
    expect(markup).toContain('attempt_reason');
    expect(markup).toContain('Workflow relations');
    expect(markup).toContain('1 related workflow');
    expect(markup).toContain('Run health and risk');
    expect(markup).toContain('1 blocked work item');
    expect(markup).toContain('1 open escalation');
  });
});

function buildOverview(
  latestOutput: DashboardMissionControlOutputDescriptor,
): DashboardMissionControlWorkspaceOverview {
  return {
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
    availableActions: [],
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
    version: {
      generatedAt: '2026-03-27T05:00:00.000Z',
      latestEventId: 42,
      token: 'mission-control:test',
    },
  };
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
