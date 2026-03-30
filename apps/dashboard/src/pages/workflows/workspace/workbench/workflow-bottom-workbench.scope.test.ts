import { describe, expect, it } from 'vitest';

import type { DashboardWorkflowWorkspacePacket } from '../../../../lib/api.js';
import type { WorkflowWorkbenchScopeDescriptor } from '../../workflows-page.support.js';
import { resolveWorkbenchScope } from './workflow-bottom-workbench.scope.js';

describe('resolveWorkbenchScope', () => {
  it('normalizes task-scoped packets back to the parent work item banner', () => {
    const scope = resolveWorkbenchScope({
      packet: createPacket({
        selected_scope: {
          scope_kind: 'selected_task',
          work_item_id: 'work-item-7',
          task_id: 'task-1',
        },
        bottom_tabs: {
          default_tab: 'details',
          current_scope_kind: 'selected_task',
          current_work_item_id: 'work-item-7',
          current_task_id: 'task-1',
          counts: {
            details: 0,
            needs_action: 0,
            steering: 0,
            live_console_activity: 0,
            history: 0,
            deliverables: 0,
          },
        },
      }),
      workflowName: 'Workflow 1',
      selectedWorkItemTitle: 'Prepare release bundle',
      scope: createScope('workflow', 'Workflow 1'),
    });

    expect(scope).toEqual({
      scopeKind: 'selected_work_item',
      title: 'Work item',
      subject: 'work item',
      name: 'Prepare release bundle',
      banner: 'Work item · Prepare release bundle',
    });
  });

  it('falls back to the workflow banner when no narrower work-item scope is active', () => {
    const scope = resolveWorkbenchScope({
      packet: createPacket(),
      workflowName: 'Workflow 1',
      selectedWorkItemTitle: null,
      scope: createScope('workflow', 'Workflow 1'),
    });

    expect(scope).toEqual({
      scopeKind: 'workflow',
      title: 'Workflow',
      subject: 'workflow',
      name: 'Workflow 1',
      banner: 'Workflow',
    });
  });
});

function createPacket(
  overrides: Partial<DashboardWorkflowWorkspacePacket> = {},
): DashboardWorkflowWorkspacePacket {
  const basePacket: DashboardWorkflowWorkspacePacket = {
    workflow_id: 'workflow-1',
    generated_at: '2026-03-30T00:00:00.000Z',
    latest_event_id: null,
    snapshot_version: 'snapshot-1',
    workflow: null,
    sticky_strip: null,
    board: null,
    selected_scope: {
      scope_kind: 'workflow',
      work_item_id: null,
      task_id: null,
    },
    bottom_tabs: {
      default_tab: 'details',
      current_scope_kind: 'workflow',
      current_work_item_id: null,
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
      quick_actions: [],
      decision_actions: [],
      steering_state: {
        mode: 'selected_work_item',
        can_accept_request: false,
        active_session_id: null,
        last_summary: null,
      },
      recent_interventions: [],
      session: {
        session_id: null,
        status: 'idle',
        messages: [],
      },
    },
    live_console: {
      generated_at: '2026-03-30T00:00:00.000Z',
      latest_event_id: null,
      snapshot_version: 'snapshot-1',
      items: [],
      next_cursor: null,
      total_count: 0,
    },
    needs_action: {
      items: [],
      total_count: 0,
      default_sort: 'priority_desc',
    },
    history: {
      generated_at: '2026-03-30T00:00:00.000Z',
      latest_event_id: null,
      snapshot_version: 'snapshot-1',
      groups: [],
      items: [],
      filters: {
        available: [],
        active: [],
      },
      next_cursor: null,
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
      next_cursor: null,
    },
    redrive_lineage: null,
  };

  return {
    ...basePacket,
    ...overrides,
    selected_scope: {
      scope_kind: overrides.selected_scope?.scope_kind ?? basePacket.selected_scope.scope_kind,
      work_item_id: overrides.selected_scope?.work_item_id ?? basePacket.selected_scope.work_item_id,
      task_id: overrides.selected_scope?.task_id ?? basePacket.selected_scope.task_id,
    },
    bottom_tabs: {
      default_tab: overrides.bottom_tabs?.default_tab ?? basePacket.bottom_tabs.default_tab,
      current_scope_kind: overrides.bottom_tabs?.current_scope_kind ?? basePacket.bottom_tabs.current_scope_kind,
      current_work_item_id: overrides.bottom_tabs?.current_work_item_id ?? basePacket.bottom_tabs.current_work_item_id,
      current_task_id: overrides.bottom_tabs?.current_task_id ?? basePacket.bottom_tabs.current_task_id,
      counts: {
        details: overrides.bottom_tabs?.counts?.details ?? basePacket.bottom_tabs.counts.details,
        needs_action: overrides.bottom_tabs?.counts?.needs_action ?? basePacket.bottom_tabs.counts.needs_action,
        steering: overrides.bottom_tabs?.counts?.steering ?? basePacket.bottom_tabs.counts.steering,
        live_console_activity:
          overrides.bottom_tabs?.counts?.live_console_activity ?? basePacket.bottom_tabs.counts.live_console_activity,
        history: overrides.bottom_tabs?.counts?.history ?? basePacket.bottom_tabs.counts.history,
        deliverables: overrides.bottom_tabs?.counts?.deliverables ?? basePacket.bottom_tabs.counts.deliverables,
      },
    },
  };
}

function createScope(
  scopeKind: WorkflowWorkbenchScopeDescriptor['scopeKind'],
  name: string,
): WorkflowWorkbenchScopeDescriptor {
  if (scopeKind === 'workflow') {
    return {
      scopeKind,
      title: 'Workflow',
      subject: 'workflow',
      name,
      banner: `Workflow: ${name}`,
    };
  }

  return {
    scopeKind,
    title: 'Work item',
    subject: 'work item',
    name,
    banner: `Work item: ${name}`,
  };
}
