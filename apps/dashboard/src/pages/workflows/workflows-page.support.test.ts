import { describe, expect, it } from 'vitest';

import type { DashboardWorkflowWorkspacePacket } from '../../lib/api.js';
import {
  describeHeaderAddWorkLabel,
  describeWorkflowWorkbenchScope,
  buildWorkflowDiagnosticsHref,
  buildWorkflowsPageHref,
  resolveHeaderAddWorkTargetWorkItemId,
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
      tab: 'history',
      search: 'release',
      needsActionOnly: true,
      ongoingOnly: true,
      boardMode: 'all',
    });
  });

  it('normalizes stale steering/task query params back to the supported workflow/work-item model', () => {
    expect(
      readWorkflowsPageState(
        '/workflows/workflow-9',
        new URLSearchParams(
          'work_item_id=work-item-2&task_id=task-4&tab=steering',
        ),
      ),
    ).toEqual({
      mode: 'live',
      workflowId: 'workflow-9',
      workItemId: 'work-item-2',
      tab: 'details',
      search: '',
      needsActionOnly: false,
      ongoingOnly: false,
      boardMode: 'active_recent_complete',
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
      '/workflows/workflow-2?mode=recent&work_item_id=work-item-7&tab=deliverables&search=release+readiness&needs_action_only=1&ongoing_only=1&board_mode=all',
    );
    expect(buildWorkflowsPageHref({})).toBe('/workflows');
  });

  it('uses workflow or work-item scope only across every workbench tab', () => {
    expect(resolveWorkflowTabScope('details', 'work-item-7', null)).toBe('selected_work_item');
    expect(resolveWorkflowTabScope('needs_action', 'work-item-7', null)).toBe('selected_work_item');
    expect(resolveWorkflowTabScope('live_console', 'work-item-7', null)).toBe('selected_work_item');
    expect(resolveWorkflowTabScope('history', 'work-item-7', null)).toBe('selected_work_item');
    expect(resolveWorkflowTabScope('deliverables', 'work-item-7', null)).toBe('selected_work_item');
    expect(resolveWorkflowTabScope('details', 'work-item-7', 'task-4')).toBe('selected_work_item');
    expect(resolveWorkflowTabScope('needs_action', 'work-item-7', 'task-4')).toBe('selected_work_item');
    expect(resolveWorkflowTabScope('live_console', 'work-item-7', 'task-4')).toBe('selected_work_item');
    expect(resolveWorkflowTabScope('history', 'work-item-7', 'task-4')).toBe('selected_work_item');
    expect(resolveWorkflowTabScope('live_console', null, null)).toBe('workflow');
  });

  it('opens header add-or-modify in modify mode only for explicit work-item scope', () => {
    expect(
      resolveHeaderAddWorkTargetWorkItemId({
        scopeKind: 'selected_work_item',
        workItemId: 'work-item-7',
      }),
    ).toBe('work-item-7');
    expect(
      resolveHeaderAddWorkTargetWorkItemId({
        scopeKind: 'workflow',
        workItemId: 'work-item-7',
      }),
    ).toBeNull();
  });

  it('describes the header add-work label from the active scope and lifecycle', () => {
    expect(
      describeHeaderAddWorkLabel({
        scopeKind: 'selected_work_item',
        lifecycle: 'ongoing',
      }),
    ).toBe('Modify Work');
    expect(
      describeHeaderAddWorkLabel({
        scopeKind: 'workflow',
        lifecycle: 'planned',
      }),
    ).toBe('Add Work');
  });

  it('describes the exact shell scope banner for workflow and work item views only', () => {
    expect(
      describeWorkflowWorkbenchScope({
        scopeKind: 'workflow',
        workflowName: 'Release Workflow',
        workItemId: null,
        workItemTitle: null,
      }),
    ).toMatchObject({
      scopeKind: 'workflow',
      title: 'Workflow',
      subject: 'workflow',
      banner: 'Workflow · Release Workflow',
    });
    expect(
      describeWorkflowWorkbenchScope({
        scopeKind: 'selected_work_item',
        workflowName: 'Release Workflow',
        workItemId: 'work-item-7',
        workItemTitle: 'Prepare release bundle',
      }),
    ).toMatchObject({
      scopeKind: 'selected_work_item',
      title: 'Work item',
      subject: 'work item',
      banner: 'Work item · Prepare release bundle',
    });
  });

  it('normalizes stale task-scoped banner input back to the selected work item', () => {
    expect(
      describeWorkflowWorkbenchScope({
        scopeKind: 'selected_task',
        workflowName: 'Release Workflow',
        workItemId: 'work-item-7',
        workItemTitle: 'Prepare release bundle',
      }),
    ).toMatchObject({
      scopeKind: 'selected_work_item',
      title: 'Work item',
      subject: 'work item',
      banner: 'Work item · Prepare release bundle',
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
        total_count: 0,
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

function createWorkspacePacket(): DashboardWorkflowWorkspacePacket {
  return {
    generated_at: '2026-03-28T03:00:00.000Z',
    latest_event_id: 10,
    snapshot_version: 'workflow-operations:10',
    workflow_id: 'workflow-1',
    workflow: {
      id: 'workflow-1',
      name: 'Release Workflow',
      state: 'active',
      lifecycle: 'continuous',
      currentStage: null,
      workspaceId: 'workspace-1',
      workspaceName: 'Launch Workspace',
      playbookId: 'playbook-1',
      playbookName: 'Release Playbook',
      posture: 'progressing',
      attentionLane: 'watchlist',
      pulse: {
        summary: 'Workflow is active.',
        tone: 'progressing',
        updatedAt: '2026-03-28T03:00:00.000Z',
      },
      outputDescriptors: [],
      availableActions: [],
      metrics: {
        activeTaskCount: 1,
        activeWorkItemCount: 1,
        blockedWorkItemCount: 0,
        openEscalationCount: 0,
        waitingForDecisionCount: 0,
        failedTaskCount: 0,
        recoverableIssueCount: 0,
        lastChangedAt: '2026-03-28T03:00:00.000Z',
      },
      version: {
        generatedAt: '2026-03-28T03:00:00.000Z',
        latestEventId: 10,
        token: 'workflow-operations:10',
      },
    },
    selected_scope: {
      scope_kind: 'workflow' as const,
      work_item_id: null,
      task_id: null,
    },
    sticky_strip: {
      workflow_id: 'workflow-1',
      workflow_name: 'Release Workflow',
      posture: 'progressing',
      summary: 'Workflow is active.',
      approvals_count: 0,
      escalations_count: 0,
      blocked_work_item_count: 0,
      active_task_count: 1,
      active_work_item_count: 1,
      steering_available: true,
    },
    board: {
      columns: [],
      work_items: [],
      active_stages: [],
      awaiting_gate_count: 0,
      stage_summary: [],
    },
    bottom_tabs: {
      default_tab: 'details',
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
    needs_action: {
      items: [],
      total_count: 0,
      default_sort: 'priority_desc',
    },
    steering: {
      quick_actions: [],
      decision_actions: [],
      recent_interventions: [],
      session: {
        session_id: 'session-1',
        status: 'active',
        messages: [],
      },
      steering_state: {
        mode: 'workflow_scoped' as const,
        can_accept_request: true,
        active_session_id: 'session-1',
        last_summary: 'Recent request',
      },
    },
    live_console: {
      generated_at: '2026-03-28T03:00:00.000Z',
      latest_event_id: 10,
      snapshot_version: 'workflow-operations:10',
      total_count: 8,
      next_cursor: 'cursor-1',
      items: [],
    },
    history: {
      generated_at: '2026-03-28T03:00:00.000Z',
      latest_event_id: 10,
      snapshot_version: 'workflow-operations:10',
      groups: [],
      items: [],
      filters: {
        available: [],
        active: [],
      },
      next_cursor: 'cursor-1',
    },
    deliverables: {
      final_deliverables: [],
      in_progress_deliverables: [],
      working_handoffs: [],
      inputs_and_provenance: {
        launch_packet: null,
        supplemental_packets: [],
        intervention_attachments: [],
        redrive_packet: null,
      },
      next_cursor: 'cursor-1',
    },
    redrive_lineage: null,
  };
}
