import { describe, expect, it } from 'vitest';

import {
  buildWorkflowDiagnosticsHref,
  buildWorkflowsPageHref,
  readWorkflowsPageState,
} from './workflows-page.support.js';

describe('workflows page support', () => {
  it('reads defaults from empty search params', () => {
    expect(readWorkflowsPageState(new URLSearchParams())).toEqual({
      mode: 'live',
      workflowId: null,
      workItemId: null,
      tab: null,
      search: '',
      needsActionOnly: false,
      ongoingOnly: false,
      boardMode: 'active_recent_complete',
    });
  });

  it('normalizes recent mode and known shell state from search params', () => {
    expect(
      readWorkflowsPageState(
        new URLSearchParams(
          'mode=history&workflow=workflow-9&work_item=work-item-2&tab=history&q=release&needs_action_only=1&ongoing_only=true&board_mode=all',
        ),
      ),
    ).toEqual({
      mode: 'recent',
      workflowId: 'workflow-9',
      workItemId: 'work-item-2',
      tab: 'history',
      search: 'release',
      needsActionOnly: true,
      ongoingOnly: true,
      boardMode: 'all',
    });
  });

  it('builds canonical workflows hrefs from partial shell state', () => {
    expect(
      buildWorkflowsPageHref({
        mode: 'recent',
        workflowId: 'workflow-2',
        workItemId: 'work-item-7',
        tab: 'deliverables',
        search: 'release readiness',
        needsActionOnly: true,
        ongoingOnly: true,
        boardMode: 'all',
      }),
    ).toBe(
      '/workflows?mode=recent&workflow=workflow-2&work_item=work-item-7&tab=deliverables&q=release+readiness&needs_action_only=1&ongoing_only=1&board_mode=all',
    );
    expect(buildWorkflowsPageHref({})).toBe('/workflows');
  });

  it('builds workflow-scoped diagnostics hrefs for live evidence', () => {
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
