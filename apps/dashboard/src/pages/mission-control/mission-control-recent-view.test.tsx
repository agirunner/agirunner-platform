import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import type { DashboardMissionControlRecentResponse } from '../../lib/api.js';
import { MissionControlRecentView } from './mission-control-recent-view.js';

describe('mission control recent view', () => {
  it('renders review packets and carryover cues for shift handoff', () => {
    const markup = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        undefined,
        createElement(MissionControlRecentView, {
          response: buildResponse(),
          isLoading: false,
          lens: 'workflows',
          taskLensResponse: [],
        }),
      ),
    );

    expect(markup).toContain('Shift handoff');
    expect(markup).toContain('Release workflow completed with final artifacts');
    expect(markup).toContain('Carryover');
    expect(markup).toContain('Open workflow');
  });

  it('renders the task lens when recent mode switches away from workflows', () => {
    const markup = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        undefined,
        createElement(MissionControlRecentView, {
          response: buildResponse(),
          isLoading: false,
          lens: 'tasks',
          taskLensResponse: [
            {
              id: 'task-1',
              workflow_id: 'workflow-1',
              workflow_name: 'Release workflow',
              state: 'completed',
              status: 'completed',
              title: 'Review output packet',
              role: 'reviewer',
              created_at: '2026-03-27T16:18:00.000Z',
              completed_at: '2026-03-27T16:19:00.000Z',
            },
          ],
        }),
      ),
    );

    expect(markup).toContain('Recent task lens');
    expect(markup).toContain('Open workflow context');
  });
});

function buildResponse(): DashboardMissionControlRecentResponse {
  return {
    version: {
      generatedAt: '2026-03-27T16:20:00.000Z',
      latestEventId: 31,
      token: 'mission-control:31',
    },
    packets: [
      {
        id: 'packet-1',
        workflowId: 'workflow-1',
        workflowName: 'Release workflow',
        posture: 'completed',
        category: 'output',
        title: 'Release workflow completed with final artifacts',
        summary: 'Two final deliverables were published and one approval remains open for follow-up.',
        changedAt: '2026-03-27T16:19:00.000Z',
        carryover: true,
        outputDescriptors: [],
      },
    ],
  };
}
