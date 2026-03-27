import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import type { DashboardMissionControlLiveSection } from '../../lib/api.js';
import { MissionControlCanvas } from './mission-control-canvas.js';

describe('mission control canvas', () => {
  it('renders posture sections, workflow pulses, output snapshots, and selection links', () => {
    const markup = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        undefined,
        createElement(MissionControlCanvas, {
          sections: buildSections(),
          selectedWorkflowId: 'workflow-1',
          onSelectWorkflow: () => undefined,
        }),
      ),
    );

    expect(markup).toContain('Needs Action');
    expect(markup).toContain('Progressing');
    expect(markup).toContain('Spec draft updated');
    expect(markup).toContain('Release Readiness');
    expect(markup).toContain('Payments rollout');
    expect(markup).toContain('Waiting on approval for launch');
    expect(markup).toContain('Implementation is updating the retry flow');
    expect(markup).toContain('2 active tasks');
    expect(markup).toContain('1 open escalation');
    expect(markup).toContain('href="/mission-control?rail=workflow&amp;workflow=workflow-1"');
    expect(markup).toContain('aria-label="Open Release Readiness workflow"');
    expect(markup).toContain('Current focus');
  });
});

function buildSections(): DashboardMissionControlLiveSection[] {
  return [
    {
      id: 'needs_action',
      title: 'Needs Action',
      count: 1,
      workflows: [
        {
          id: 'workflow-1',
          name: 'Release Readiness',
          state: 'active',
          lifecycle: 'planned',
          currentStage: 'launch',
          workspaceId: 'workspace-1',
          workspaceName: 'Release Ops',
          playbookId: 'playbook-1',
          playbookName: 'Launch Review',
          posture: 'needs_decision',
          attentionLane: 'needs_decision',
          pulse: {
            summary: 'Waiting on approval for launch',
            tone: 'warning',
            updatedAt: '2026-03-27T16:00:00.000Z',
          },
          outputDescriptors: [
            {
              id: 'output-1',
              title: 'Spec draft updated',
              summary: 'Launch summary draft',
              status: 'under_review',
              producedByRole: 'Reviewer',
              workItemId: 'work-item-1',
              taskId: 'task-1',
              stageName: 'launch',
              primaryLocation: {
                kind: 'workflow_document',
                workflowId: 'workflow-1',
                documentId: 'doc-1',
                logicalName: 'launch-summary',
                source: 'artifact',
                location: '/docs/launch-summary.md',
                artifactId: 'artifact-1',
              },
              secondaryLocations: [],
            },
          ],
          availableActions: [],
          metrics: {
            activeTaskCount: 2,
            activeWorkItemCount: 1,
            blockedWorkItemCount: 0,
            openEscalationCount: 1,
            waitingForDecisionCount: 1,
            failedTaskCount: 0,
            recoverableIssueCount: 0,
            lastChangedAt: '2026-03-27T16:05:00.000Z',
          },
          version: {
            generatedAt: '2026-03-27T16:05:00.000Z',
            latestEventId: 22,
            token: 'mission-control:22',
          },
        },
      ],
    },
    {
      id: 'progressing',
      title: 'Progressing',
      count: 1,
      workflows: [
        {
          id: 'workflow-2',
          name: 'Payments rollout',
          state: 'active',
          lifecycle: 'ongoing',
          currentStage: null,
          workspaceId: 'workspace-2',
          workspaceName: 'Payments',
          playbookId: 'playbook-2',
          playbookName: 'Rollout',
          posture: 'progressing',
          attentionLane: 'watchlist',
          pulse: {
            summary: 'Implementation is updating the retry flow',
            tone: 'progressing',
            updatedAt: '2026-03-27T16:06:00.000Z',
          },
          outputDescriptors: [],
          availableActions: [],
          metrics: {
            activeTaskCount: 1,
            activeWorkItemCount: 2,
            blockedWorkItemCount: 0,
            openEscalationCount: 0,
            waitingForDecisionCount: 0,
            failedTaskCount: 0,
            recoverableIssueCount: 0,
            lastChangedAt: '2026-03-27T16:06:00.000Z',
          },
          version: {
            generatedAt: '2026-03-27T16:06:00.000Z',
            latestEventId: 23,
            token: 'mission-control:23',
          },
        },
      ],
    },
  ];
}
