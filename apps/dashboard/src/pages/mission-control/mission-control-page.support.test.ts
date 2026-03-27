import { describe, expect, it } from 'vitest';

import {
  buildMissionControlShellHref,
  buildWorkflowDiagnosticsHref,
  readMissionControlShellState,
} from './mission-control-page.support.js';

describe('mission control page support', () => {
  it('reads shell defaults from empty search params', () => {
    expect(readMissionControlShellState(new URLSearchParams())).toEqual({
      mode: 'live',
      rail: 'attention',
      lens: 'workflows',
      workflowId: null,
      tab: 'overview',
      savedView: 'all-active',
      scope: 'entire-tenant',
    });
  });

  it('normalizes shell state from search params', () => {
    expect(
      readMissionControlShellState(
        new URLSearchParams(
          'mode=history&rail=workflow&lens=tasks&workflow=workflow-9&tab=history&view=shipping&scope=watchlist',
        ),
      ),
    ).toEqual({
      mode: 'history',
      rail: 'workflow',
      lens: 'tasks',
      workflowId: 'workflow-9',
      tab: 'history',
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
        tab: 'board',
        savedView: 'release-train',
        scope: 'workspace:alpha',
      }),
    ).toBe(
      '/mission-control?mode=recent&rail=workflow&lens=tasks&workflow=workflow-2&tab=board&view=release-train&scope=workspace%3Aalpha',
    );
    expect(buildMissionControlShellHref({ rail: 'attention' })).toBe('/mission-control');
  });

  it('builds scoped live-log diagnostics hrefs for workflow evidence', () => {
    expect(buildWorkflowDiagnosticsHref({ workflowId: 'workflow-2' })).toBe(
      '/diagnostics/live-logs?workflow=workflow-2',
    );
    expect(
      buildWorkflowDiagnosticsHref({
        workflowId: 'workflow-2',
        taskId: 'task-9',
        view: 'summary',
      }),
    ).toBe('/diagnostics/live-logs?workflow=workflow-2&task=task-9&view=summary');
  });
});
