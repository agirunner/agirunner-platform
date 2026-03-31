import { describe, expect, it } from 'vitest';

import type { DashboardWorkflowWorkspacePacket } from '../../lib/api.js';
import { resolveWorkspacePlaceholderData } from './workflows-page.support.js';

describe('workflows page placeholder data', () => {
  it('keeps previous workspace data only when the workflow id stays the same', () => {
    const currentWorkflowPacket = createWorkspacePacket();

    expect(
      resolveWorkspacePlaceholderData(currentWorkflowPacket, {
        workflowId: 'workflow-1',
        scopeKind: 'workflow',
        workItemId: null,
      }),
    ).toBe(currentWorkflowPacket);
    expect(
      resolveWorkspacePlaceholderData(currentWorkflowPacket, {
        workflowId: 'workflow-2',
        scopeKind: 'workflow',
        workItemId: null,
      }),
    ).toBeUndefined();
    expect(
      resolveWorkspacePlaceholderData(currentWorkflowPacket, {
        workflowId: null,
        scopeKind: 'workflow',
        workItemId: null,
      }),
    ).toBeUndefined();
    expect(
      resolveWorkspacePlaceholderData(undefined, {
        workflowId: 'workflow-1',
        scopeKind: 'workflow',
        workItemId: null,
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
      scope_kind: 'workflow',
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
      current_scope_kind: 'workflow',
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
        mode: 'workflow_scoped',
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
