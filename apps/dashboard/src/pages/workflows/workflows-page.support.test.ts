import { describe, expect, it } from 'vitest';

import {
  buildWorkflowDiagnosticsHref,
  buildWorkflowsPageHref,
  resolveWorkspacePlaceholderData,
  resolveWorkflowTabScope,
  readWorkflowsPageState,
} from './workflows-page.support.js';

describe('workflows page support', () => {
  it('reads defaults from empty search params', () => {
    expect(readWorkflowsPageState('/workflows', new URLSearchParams())).toEqual({
      mode: 'live',
      workflowId: null,
      workItemId: null,
      taskId: null,
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
        '/workflows/workflow-9',
        new URLSearchParams(
          'mode=history&work_item_id=work-item-2&task_id=task-4&tab=history&search=release&needs_action_only=1&ongoing_only=true&board_mode=all',
        ),
      ),
    ).toEqual({
      mode: 'recent',
      workflowId: 'workflow-9',
      workItemId: 'work-item-2',
      taskId: 'task-4',
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
        taskId: 'task-2',
        tab: 'deliverables',
        search: 'release readiness',
        needsActionOnly: true,
        ongoingOnly: true,
        boardMode: 'all',
      }),
    ).toBe(
      '/workflows/workflow-2?mode=recent&work_item_id=work-item-7&task_id=task-2&tab=deliverables&search=release+readiness&needs_action_only=1&ongoing_only=1&board_mode=all',
    );
    expect(buildWorkflowsPageHref({})).toBe('/workflows');
  });

  it('supports task scope for task-selected tabs while keeping needs action workflow-scoped', () => {
    expect(resolveWorkflowTabScope('details', 'work-item-7', null)).toBe('selected_work_item');
    expect(resolveWorkflowTabScope('needs_action', 'work-item-7', null)).toBe('workflow');
    expect(resolveWorkflowTabScope('steering', 'work-item-7', null)).toBe('selected_work_item');
    expect(resolveWorkflowTabScope('live_console', 'work-item-7', null)).toBe('selected_work_item');
    expect(resolveWorkflowTabScope('history', 'work-item-7', null)).toBe('selected_work_item');
    expect(resolveWorkflowTabScope('deliverables', 'work-item-7', null)).toBe('selected_work_item');
    expect(resolveWorkflowTabScope('details', 'work-item-7', 'task-4')).toBe('selected_task');
    expect(resolveWorkflowTabScope('steering', 'work-item-7', 'task-4')).toBe('selected_task');
    expect(resolveWorkflowTabScope('live_console', 'work-item-7', 'task-4')).toBe('selected_task');
    expect(resolveWorkflowTabScope('history', 'work-item-7', 'task-4')).toBe('selected_task');
    expect(resolveWorkflowTabScope('live_console', null, null)).toBe('workflow');
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

  it('keeps previous workspace data only when the workflow id stays the same', () => {
    const currentWorkflowPacket = {
      workflow: { id: 'workflow-1' },
      board: { work_items: [] },
    };

    expect(resolveWorkspacePlaceholderData(currentWorkflowPacket, 'workflow-1')).toBe(
      currentWorkflowPacket,
    );
    expect(resolveWorkspacePlaceholderData(currentWorkflowPacket, 'workflow-2')).toBeUndefined();
    expect(resolveWorkspacePlaceholderData(currentWorkflowPacket, null)).toBeUndefined();
    expect(resolveWorkspacePlaceholderData(undefined, 'workflow-1')).toBeUndefined();
  });
});
