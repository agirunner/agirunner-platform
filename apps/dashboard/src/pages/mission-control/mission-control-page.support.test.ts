import { describe, expect, it } from 'vitest';

import {
  buildMissionControlShellHref,
  readMissionControlShellState,
} from './mission-control-page.support.js';

describe('mission control page support', () => {
  it('reads shell defaults from empty search params', () => {
    expect(readMissionControlShellState(new URLSearchParams())).toEqual({
      mode: 'live',
      rail: 'attention',
      lens: 'workflows',
      workflowId: null,
      savedView: 'all-active',
      scope: 'entire-tenant',
    });
  });

  it('normalizes shell state from search params', () => {
    expect(
      readMissionControlShellState(
        new URLSearchParams(
          'mode=history&rail=workflow&lens=tasks&workflow=workflow-9&view=shipping&scope=watchlist',
        ),
      ),
    ).toEqual({
      mode: 'history',
      rail: 'workflow',
      lens: 'tasks',
      workflowId: 'workflow-9',
      savedView: 'shipping',
      scope: 'watchlist',
    });
  });

  it('builds a canonical shell href from partial state', () => {
    expect(
      buildMissionControlShellHref({
        mode: 'recent',
        rail: 'workflow',
        lens: 'tasks',
        workflowId: 'workflow-2',
        savedView: 'release-train',
        scope: 'workspace:alpha',
      }),
    ).toBe(
      '/mission-control?mode=recent&rail=workflow&lens=tasks&workflow=workflow-2&view=release-train&scope=workspace%3Aalpha',
    );
    expect(buildMissionControlShellHref({ rail: 'attention' })).toBe('/mission-control');
  });
});
