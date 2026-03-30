import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { DashboardWorkflowWorkspacePacket } from '../../../lib/api.js';
import { WorkflowBottomWorkbench } from './workflow-bottom-workbench.js';

export function createPacket(): DashboardWorkflowWorkspacePacket {
  return {
    generated_at: '2026-03-28T03:00:00.000Z',
    latest_event_id: 10,
    snapshot_version: 'workflow-operations:10',
    workflow_id: 'workflow-1',
    workflow: {
      id: 'workflow-1',
      name: 'Workflow 1',
      state: 'active',
      lifecycle: 'planned',
      currentStage: null,
      workspaceId: 'workspace-1',
      workspaceName: 'Workspace',
      playbookId: 'playbook-1',
      playbookName: 'Playbook',
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
      workflow_name: 'Workflow 1',
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
        needs_action: 0,
        steering: 0,
        live_console_activity: 0,
        briefs: 0,
        history: 0,
        deliverables: 0,
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
      steering_state: {
        mode: 'workflow_scoped',
        can_accept_request: true,
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
      generated_at: '2026-03-28T03:00:00.000Z',
      latest_event_id: 10,
      snapshot_version: 'workflow-operations:10',
      next_cursor: null,
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
      next_cursor: null,
    },
    briefs: {
      generated_at: '2026-03-28T03:00:00.000Z',
      latest_event_id: 10,
      snapshot_version: 'workflow-operations:10',
      items: [],
      total_count: 0,
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
}

export function createWorkbenchProps(
  overrides: Partial<ComponentProps<typeof WorkflowBottomWorkbench>> = {},
): ComponentProps<typeof WorkflowBottomWorkbench> {
  const packet = overrides.packet ?? createPacket();

  return {
    workflowId: 'workflow-1',
    workflow: overrides.workflow ?? packet.workflow,
    stickyStrip: overrides.stickyStrip ?? packet.sticky_strip,
    board: overrides.board ?? packet.board,
    workflowName: overrides.workflowName ?? 'Workflow 1',
    packet,
    activeTab: overrides.activeTab ?? 'details',
    selectedWorkItemId: overrides.selectedWorkItemId ?? null,
    scopedWorkItemId: overrides.scopedWorkItemId ?? null,
    selectedWorkItemTitle: overrides.selectedWorkItemTitle ?? null,
    selectedWorkItem: overrides.selectedWorkItem ?? null,
    selectedWorkItemTasks: overrides.selectedWorkItemTasks ?? [],
    inputPackets: overrides.inputPackets ?? [],
    workflowParameters: overrides.workflowParameters ?? null,
    scope:
      overrides.scope ?? {
        scopeKind: 'workflow',
        title: 'Workflow',
        subject: 'workflow',
        name: 'Workflow 1',
        banner: 'Workflow: Workflow 1',
      },
    isScopeLoading: overrides.isScopeLoading ?? false,
    onTabChange: overrides.onTabChange ?? (() => undefined),
    onClearWorkItemScope: overrides.onClearWorkItemScope ?? (() => undefined),
    onOpenAddWork: overrides.onOpenAddWork ?? (() => undefined),
    onLoadMoreActivity: overrides.onLoadMoreActivity ?? (() => undefined),
    onLoadMoreDeliverables: overrides.onLoadMoreDeliverables ?? (() => undefined),
  };
}

export function renderWorkbench(
  overrides: Partial<ComponentProps<typeof WorkflowBottomWorkbench>> = {},
): string {
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(WorkflowBottomWorkbench, createWorkbenchProps(overrides)),
    ),
  );
}
