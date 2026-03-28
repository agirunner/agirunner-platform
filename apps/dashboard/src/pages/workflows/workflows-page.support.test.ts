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
    const currentWorkflowPacket = createWorkspacePacket();

    expect(
      resolveWorkspacePlaceholderData(currentWorkflowPacket, {
        workflowId: 'workflow-1',
        scopeKind: 'workflow',
        workItemId: null,
        taskId: null,
      }),
    ).toBe(
      currentWorkflowPacket,
    );
    expect(
      resolveWorkspacePlaceholderData(currentWorkflowPacket, {
        workflowId: 'workflow-2',
        scopeKind: 'workflow',
        workItemId: null,
        taskId: null,
      }),
    ).toBeUndefined();
    expect(
      resolveWorkspacePlaceholderData(currentWorkflowPacket, {
        workflowId: null,
        scopeKind: 'workflow',
        workItemId: null,
        taskId: null,
      }),
    ).toBeUndefined();
    expect(
      resolveWorkspacePlaceholderData(undefined, {
        workflowId: 'workflow-1',
        scopeKind: 'workflow',
        workItemId: null,
        taskId: null,
      }),
    ).toBeUndefined();
  });

  it('scrubs scope-sensitive counts and packets when the same workflow changes to a selected work item', () => {
    const currentWorkflowPacket = createWorkspacePacket();

    expect(
      resolveWorkspacePlaceholderData(currentWorkflowPacket, {
        workflowId: 'workflow-1',
        scopeKind: 'selected_work_item',
        workItemId: 'work-item-7',
        taskId: null,
      }),
    ).toEqual({
      ...currentWorkflowPacket,
      selected_scope: {
        scope_kind: 'selected_work_item',
        work_item_id: 'work-item-7',
        task_id: null,
      },
      bottom_tabs: {
        ...currentWorkflowPacket.bottom_tabs,
        current_scope_kind: 'selected_work_item',
        current_work_item_id: 'work-item-7',
        current_task_id: null,
        counts: {
          details: 0,
          needs_action: 0,
          steering: 0,
          live_console_activity: 0,
          history: 0,
          deliverables: 0,
        },
      },
      steering: {
        ...currentWorkflowPacket.steering,
        recent_interventions: [],
        session: {
          session_id: null,
          status: 'idle',
          messages: [],
        },
        steering_state: {
          ...currentWorkflowPacket.steering.steering_state,
          mode: 'selected_work_item',
          active_session_id: null,
          last_summary: null,
        },
      },
      live_console: {
        ...currentWorkflowPacket.live_console,
        next_cursor: null,
        items: [],
      },
      history: {
        ...currentWorkflowPacket.history,
        groups: [],
        items: [],
        next_cursor: null,
      },
      deliverables: {
        ...currentWorkflowPacket.deliverables,
        final_deliverables: [],
        in_progress_deliverables: [],
        working_handoffs: [],
        inputs_and_provenance: {
          launch_packet: null,
          supplemental_packets: [],
          intervention_attachments: [],
          redrive_packet: null,
        },
        next_cursor: null,
      },
    });
  });
});

function createWorkspacePacket() {
  return {
    workflow: { id: 'workflow-1' },
    selected_scope: {
      scope_kind: 'workflow' as const,
      work_item_id: null,
      task_id: null,
    },
    bottom_tabs: {
      current_scope_kind: 'workflow' as const,
      current_work_item_id: null,
      current_task_id: null,
      counts: {
        details: 1,
        needs_action: 2,
        steering: 1,
        live_console_activity: 8,
        history: 3,
        deliverables: 4,
      },
    },
    steering: {
      recent_interventions: [{ id: 'intervention-1' }],
      session: {
        session_id: 'session-1',
        status: 'active',
        messages: [{ id: 'message-1' }],
      },
      steering_state: {
        mode: 'workflow_scoped' as const,
        can_accept_request: true,
        active_session_id: 'session-1',
        last_summary: 'Recent request',
      },
    },
    live_console: {
      next_cursor: 'cursor-1',
      items: [{ item_id: 'item-1' }],
    },
    history: {
      groups: [{ id: 'group-1' }],
      items: [{ id: 'history-1' }],
      next_cursor: 'cursor-1',
    },
    deliverables: {
      final_deliverables: [{ id: 'deliverable-1' }],
      in_progress_deliverables: [{ id: 'deliverable-2' }],
      working_handoffs: [{ id: 'handoff-1' }],
      inputs_and_provenance: {
        launch_packet: { id: 'packet-1' },
        supplemental_packets: [{ id: 'packet-2' }],
        intervention_attachments: [{ id: 'attachment-1' }],
        redrive_packet: { id: 'packet-3' },
      },
      next_cursor: 'cursor-1',
    },
  };
}
