import { describe, expect, it } from 'vitest';

import {
  buildWorkflowDiagnosticsHref,
  buildWorkflowsLaunchHref,
  buildWorkflowsPageHref,
  readWorkflowLaunchRequest,
  readWorkflowsPageState,
} from './workflows-page.support.js';

describe('workflows page routes', () => {
  it('reads defaults from empty search params', () => {
    expect(readWorkflowsPageState('/workflows', new URLSearchParams())).toEqual({
      mode: 'live',
      workflowId: null,
      workItemId: null,
      tab: null,
      search: '',
      needsActionOnly: false,
      lifecycleFilter: 'all',
      playbookId: null,
      updatedWithin: 'all',
      boardMode: 'active_recent_complete',
    });
  });

  it('normalizes recent mode and known shell state from search params', () => {
    expect(
      readWorkflowsPageState(
        '/workflows/workflow-9',
        new URLSearchParams(
          'mode=history&work_item_id=work-item-2&task_id=task-4&tab=history&search=release&needs_action_only=1&lifecycle=ongoing&board_mode=all',
        ),
      ),
    ).toEqual({
      mode: 'recent',
      workflowId: 'workflow-9',
      workItemId: 'work-item-2',
      tab: 'live_console',
      search: 'release',
      needsActionOnly: true,
      lifecycleFilter: 'ongoing',
      playbookId: null,
      updatedWithin: 'all',
      boardMode: 'all',
    });
  });

  it('normalizes stale steering and task query params back to the supported model', () => {
    expect(
      readWorkflowsPageState(
        '/workflows/workflow-9',
        new URLSearchParams('work_item_id=work-item-2&task_id=task-4&tab=steering'),
      ),
    ).toEqual({
      mode: 'live',
      workflowId: 'workflow-9',
      workItemId: 'work-item-2',
      tab: 'details',
      search: '',
      needsActionOnly: false,
      lifecycleFilter: 'all',
      playbookId: null,
      updatedWithin: 'all',
      boardMode: 'active_recent_complete',
    });
  });

  it('reads and builds advanced rail filters from canonical search params', () => {
    const parsed = readWorkflowsPageState(
      '/workflows/workflow-2',
      new URLSearchParams(
        'work_item_id=work-item-7&playbook_id=playbook-9&updated_within=7d&lifecycle=planned',
      ),
    );

    expect(parsed).toEqual({
      mode: 'live',
      workflowId: 'workflow-2',
      workItemId: 'work-item-7',
      tab: null,
      search: '',
      needsActionOnly: false,
      lifecycleFilter: 'planned',
      playbookId: 'playbook-9',
      updatedWithin: '7d',
      boardMode: 'active_recent_complete',
    });
    expect(buildWorkflowsPageHref({}, parsed)).toBe(
      '/workflows/workflow-2?work_item_id=work-item-7&lifecycle=planned&playbook_id=playbook-9&updated_within=7d',
    );
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
        lifecycleFilter: 'ongoing',
        playbookId: 'playbook-5',
        updatedWithin: '30d',
        boardMode: 'all',
      }),
    ).toBe(
      '/workflows/workflow-2?mode=recent&work_item_id=work-item-7&tab=deliverables&search=release+readiness&needs_action_only=1&lifecycle=ongoing&playbook_id=playbook-5&updated_within=30d&board_mode=all',
    );
    expect(buildWorkflowsPageHref({})).toBe('/workflows');
  });

  it('builds and reads canonical launch-dialog urls for the workflows shell', () => {
    expect(buildWorkflowsLaunchHref({})).toBe('/workflows?launch=1');
    expect(buildWorkflowsLaunchHref({ playbookId: 'playbook-7' })).toBe(
      '/workflows?launch=1&playbook=playbook-7',
    );
    expect(readWorkflowLaunchRequest(new URLSearchParams())).toEqual({
      isRequested: false,
      playbookId: null,
    });
    expect(readWorkflowLaunchRequest(new URLSearchParams('launch=1&playbook=playbook-7'))).toEqual({
      isRequested: true,
      playbookId: 'playbook-7',
    });
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
