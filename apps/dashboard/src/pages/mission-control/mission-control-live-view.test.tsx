import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import type { DashboardMissionControlLiveResponse } from '../../lib/api.js';
import { MissionControlLiveView } from './mission-control-live-view.js';

describe('mission control live view', () => {
  it('renders the workflow-first live canvas and active task-lens copy', () => {
    const markup = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        undefined,
        createElement(MissionControlLiveView, {
          response: buildResponse(),
          isLoading: false,
          selectedWorkflowId: 'workflow-1',
          lens: 'tasks',
          onSelectWorkflow: () => undefined,
        }),
      ),
    );

    expect(markup).toContain('Workflow-first live operations');
    expect(markup).toContain('Task lens is active');
    expect(markup).toContain('Release Readiness');
  });

  it('renders a loading shell while live data is pending', () => {
    const markup = renderToStaticMarkup(
      createElement(MemoryRouter, undefined, createElement(MissionControlLiveView, {
        response: null,
        isLoading: true,
        selectedWorkflowId: null,
        lens: 'workflows',
        onSelectWorkflow: () => undefined,
      })),
    );

    expect(markup).toContain('Loading live operations');
  });
});

function buildResponse(): DashboardMissionControlLiveResponse {
  return {
    version: {
      generatedAt: '2026-03-27T16:10:00.000Z',
      latestEventId: 30,
      token: 'mission-control:30',
    },
    sections: [
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
            workspaceId: null,
            workspaceName: 'Release Ops',
            playbookId: null,
            playbookName: 'Launch Review',
            posture: 'needs_decision',
            attentionLane: 'needs_decision',
            pulse: {
              summary: 'Waiting on approval for launch',
              tone: 'warning',
              updatedAt: '2026-03-27T16:09:00.000Z',
            },
            outputDescriptors: [],
            availableActions: [],
            metrics: {
              activeTaskCount: 2,
              activeWorkItemCount: 1,
              blockedWorkItemCount: 0,
              openEscalationCount: 0,
              waitingForDecisionCount: 1,
              failedTaskCount: 0,
              recoverableIssueCount: 0,
              lastChangedAt: '2026-03-27T16:09:00.000Z',
            },
            version: {
              generatedAt: '2026-03-27T16:10:00.000Z',
              latestEventId: 30,
              token: 'mission-control:30',
            },
          },
        ],
      },
    ],
    attentionItems: [
      {
        id: 'decision-1',
        lane: 'needs_decision',
        title: 'Approve launch gate',
        workflowId: 'workflow-1',
        summary: 'Launch is waiting on an operator decision.',
      },
    ],
  };
}
