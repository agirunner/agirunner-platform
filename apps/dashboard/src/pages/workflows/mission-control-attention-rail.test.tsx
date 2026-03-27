import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import type { DashboardMissionControlAttentionItem } from '../../lib/api.js';
import { MissionControlAttentionRail } from './mission-control-attention-rail.js';

describe('mission control attention rail', () => {
  it('groups attention packets by operator job and links back into workflow focus', () => {
    const markup = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        undefined,
        createElement(MissionControlAttentionRail, {
          items: [
            {
              id: 'decision-1',
              lane: 'needs_decision',
              title: 'Approve launch gate',
              workflowId: 'workflow-1',
              summary: 'Launch is waiting on an operator decision.',
            },
            {
              id: 'intervention-1',
              lane: 'needs_intervention',
              title: 'Resolve blocked implementation',
              workflowId: 'workflow-2',
              summary: 'Task failed twice and needs recovery guidance.',
            },
            {
              id: 'watch-1',
              lane: 'watchlist',
              title: 'Monitor rollout drift',
              workflowId: 'workflow-3',
              summary: 'Workflow is progressing but rework is increasing.',
            },
          ] satisfies DashboardMissionControlAttentionItem[],
        }),
      ),
    );

    expect(markup).toContain('Needs Decision');
    expect(markup).toContain('Needs Intervention');
    expect(markup).toContain('Watchlist / FYI');
    expect(markup).toContain('Approve launch gate');
    expect(markup).toContain('Resolve blocked implementation');
    expect(markup).toContain('Monitor rollout drift');
    expect(markup).toContain('href="/mission-control?rail=workflow&amp;workflow=workflow-1"');
  });
});
