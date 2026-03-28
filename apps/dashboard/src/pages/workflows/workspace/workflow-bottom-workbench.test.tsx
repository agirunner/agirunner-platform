import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { DashboardWorkflowWorkspacePacket } from '../../../lib/api.js';
import { WorkflowBottomWorkbench } from './workflow-bottom-workbench.js';

describe('WorkflowBottomWorkbench', () => {
  it('keeps the shell header compact without the redundant workspace explainer copy', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowBottomWorkbench, {
        workflowId: 'workflow-1',
        workflow: createPacket().workflow,
        stickyStrip: createPacket().sticky_strip,
        board: createPacket().board,
        workflowName: 'Workflow 1',
        packet: createPacket(),
        activeTab: 'details',
        selectedWorkItemId: null,
        scopedWorkItemId: null,
        selectedWorkItemTitle: null,
        selectedTaskId: null,
        selectedTaskTitle: null,
        selectedWorkItem: null,
        selectedTask: null,
        selectedWorkItemTasks: [],
        inputPackets: [],
        workflowParameters: null,
        onTabChange: vi.fn(),
        onClearWorkItemScope: vi.fn(),
        onClearTaskScope: vi.fn(),
        onOpenAddWork: vi.fn(),
        onOpenRedrive: vi.fn(),
        onLoadMoreActivity: vi.fn(),
        onLoadMoreDeliverables: vi.fn(),
      }),
    );

    expect(html).toContain('Workflow scope');
    expect(html).not.toContain('Details, actions, steering, live updates, history, and deliverables stay in one place.');
    expect(html).not.toContain('Workspace</p>');
  });
});

function createPacket(): DashboardWorkflowWorkspacePacket {
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
