import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import type { DashboardMissionControlHistoryResponse } from '../../lib/api.js';
import { MissionControlHistoryView } from './mission-control-history-view.js';

describe('mission control history view', () => {
  it('renders deeper packet history with packet categories and workflow links', () => {
    const markup = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        undefined,
        createElement(MissionControlHistoryView, {
          response: buildResponse(),
          isLoading: false,
        }),
      ),
    );

    expect(markup).toContain('Historical record');
    expect(markup).toContain('Operator attached rollback guide and requested replan');
    expect(markup).toContain('Intervention');
    expect(markup).toContain('href="/mission-control?mode=history&amp;rail=workflow&amp;workflow=workflow-9"');
  });
});

function buildResponse(): DashboardMissionControlHistoryResponse {
  return {
    version: {
      generatedAt: '2026-03-27T16:21:00.000Z',
      latestEventId: 32,
      token: 'mission-control:32',
    },
    packets: [
      {
        id: 'packet-9',
        workflowId: 'workflow-9',
        workflowName: 'Payments rollout',
        posture: 'recoverable_needs_steering',
        category: 'intervention',
        title: 'Operator attached rollback guide and requested replan',
        summary: 'The orchestrator now has an explicit operator intervention to consume.',
        changedAt: '2026-03-27T16:20:00.000Z',
        carryover: false,
        outputDescriptors: [],
      },
    ],
  };
}
