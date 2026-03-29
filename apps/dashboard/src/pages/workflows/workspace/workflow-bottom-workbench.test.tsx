import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import type { DashboardWorkflowWorkspacePacket } from '../../../lib/api.js';
import { WorkflowBottomWorkbench } from './workflow-bottom-workbench.js';

describe('WorkflowBottomWorkbench', () => {
  it('renders an explicit scope banner above the tabs and hides the details count badge', () => {
    const packet = {
      ...createPacket(),
      bottom_tabs: {
        ...createPacket().bottom_tabs,
        counts: {
          ...createPacket().bottom_tabs.counts,
          details: 1,
          needs_action: 2,
        },
      },
    };
    const html = renderToStaticMarkup(
      createElement(WorkflowBottomWorkbench, {
        workflowId: 'workflow-1',
        workflow: packet.workflow,
        stickyStrip: packet.sticky_strip,
        board: packet.board,
        workflowName: 'Workflow 1',
        packet,
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
        scope: {
          scopeKind: 'workflow',
          title: 'Workflow',
          subject: 'workflow',
          name: 'Workflow 1',
          banner: 'Workflow: Workflow 1',
        },
        onTabChange: vi.fn(),
        onClearWorkItemScope: vi.fn(),
        onClearTaskScope: vi.fn(),
        onOpenAddWork: vi.fn(),
        onOpenRedrive: vi.fn(),
        onLoadMoreActivity: vi.fn(),
        onLoadMoreDeliverables: vi.fn(),
      }),
    );

    expect(html).toContain('Workflow: Workflow 1');
    expect(html.indexOf('Workflow: Workflow 1')).toBeLessThan(html.indexOf('Details'));
    expect(html).toContain('Showing Workflow');
    expect(html).not.toContain('Current scope');
    expect(html).toContain('Briefs');
    expect(html).toContain('Needs Action</span><div');
    expect(html).not.toContain('Details</span><div');
    expect(html).not.toContain('Details, actions, steering, live updates, history, and deliverables stay in one place.');
    expect(html).not.toContain('History');
    expect(html).not.toContain('Workbench Scope');
    expect(html).not.toContain('Workspace</p>');
    expect(html).not.toContain('rounded-2xl border border-border/70 bg-background/70 p-3');
  });

  it('keeps task scope visible in details while the selected records are still loading', () => {
    const packet = createPacket();
    const html = renderToStaticMarkup(
      createElement(WorkflowBottomWorkbench, {
        workflowId: 'workflow-1',
        workflow: packet.workflow,
        stickyStrip: packet.sticky_strip,
        board: packet.board,
        workflowName: 'Workflow 1',
        packet: {
          ...packet,
          selected_scope: {
            scope_kind: 'selected_task',
            work_item_id: 'work-item-7',
            task_id: 'task-3',
          },
          bottom_tabs: {
            ...packet.bottom_tabs,
            current_scope_kind: 'selected_task',
            current_work_item_id: 'work-item-7',
            current_task_id: 'task-3',
          },
        },
        activeTab: 'details',
        selectedWorkItemId: 'work-item-7',
        scopedWorkItemId: 'work-item-7',
        selectedWorkItemTitle: 'Prepare release bundle',
        selectedTaskId: 'task-3',
        selectedTaskTitle: 'Verify deliverable',
        selectedWorkItem: null,
        selectedTask: null,
        selectedWorkItemTasks: [],
        inputPackets: [],
        workflowParameters: null,
        scope: {
          scopeKind: 'selected_task',
          title: 'Task',
          subject: 'task',
          name: 'Verify deliverable',
          banner: 'Task: Verify deliverable',
        },
        onTabChange: vi.fn(),
        onClearWorkItemScope: vi.fn(),
        onClearTaskScope: vi.fn(),
        onOpenAddWork: vi.fn(),
        onOpenRedrive: vi.fn(),
        onLoadMoreActivity: vi.fn(),
        onLoadMoreDeliverables: vi.fn(),
      }),
    );

    expect(html).toContain('Task: Verify deliverable');
    expect(html).toContain('Verify deliverable');
    expect(html).toContain('Showing Task');
    expect(html).toContain('Show work item');
    expect(html).toContain('Show workflow');
    expect(html).not.toContain('Selected on board');
    expect(html).not.toContain('Back to work item');
    expect(html).not.toContain('Back to workflow');
    expect(html).not.toContain('Workflow 1</h3>');
    expect(html).not.toContain('Current scope');
  });

  it('keeps steering focused on requests and history instead of header-control reminders', () => {
    const packet = createPacket();
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowBottomWorkbench, {
          workflowId: 'workflow-1',
          workflow: packet.workflow,
          stickyStrip: packet.sticky_strip,
          board: packet.board,
          workflowName: 'Workflow 1',
          packet: {
            ...packet,
            steering: {
              ...packet.steering,
              session: {
                session_id: 'session-1',
                status: 'active',
                messages: [
                  {
                    id: 'message-1',
                    workflow_id: 'workflow-1',
                    steering_session_id: 'session-1',
                    content: 'Tighten the approval brief before re-running the review.',
                    body: 'Tighten the approval brief before re-running the review.',
                    created_by_type: 'user',
                    created_by_id: 'user-1',
                    created_at: '2026-03-28T03:01:00.000Z',
                  },
                ],
              },
            },
          },
          activeTab: 'steering',
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
          scope: {
            scopeKind: 'workflow',
            title: 'Workflow',
            subject: 'workflow',
            name: 'Workflow 1',
            banner: 'Workflow: Workflow 1',
          },
          onTabChange: vi.fn(),
          onClearWorkItemScope: vi.fn(),
          onClearTaskScope: vi.fn(),
          onOpenAddWork: vi.fn(),
          onOpenRedrive: vi.fn(),
          onLoadMoreActivity: vi.fn(),
          onLoadMoreDeliverables: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('Steering request');
    expect(html).toContain('Steering history');
    expect(html).not.toContain('Use the top-right workflow controls');
    expect(html).not.toContain('Steering scope');
  });

  it('renders the live console empty state for the exact selected scope shown in the banner', () => {
    const packet = createPacket();
    const html = renderToStaticMarkup(
      createElement(WorkflowBottomWorkbench, {
        workflowId: 'workflow-1',
        workflow: packet.workflow,
        stickyStrip: packet.sticky_strip,
        board: packet.board,
        workflowName: 'Workflow 1',
        packet: {
          ...packet,
          selected_scope: {
            scope_kind: 'selected_task',
            work_item_id: 'work-item-7',
            task_id: 'task-3',
          },
          bottom_tabs: {
            ...packet.bottom_tabs,
            current_scope_kind: 'selected_task',
            current_work_item_id: 'work-item-7',
            current_task_id: 'task-3',
            counts: {
              ...packet.bottom_tabs.counts,
              live_console_activity: 0,
            },
          },
        },
        activeTab: 'live_console',
        selectedWorkItemId: 'work-item-7',
        scopedWorkItemId: 'work-item-7',
        selectedWorkItemTitle: 'Prepare release bundle',
        selectedTaskId: 'task-3',
        selectedTaskTitle: 'Verify deliverable',
        selectedWorkItem: null,
        selectedTask: null,
        selectedWorkItemTasks: [],
        inputPackets: [],
        workflowParameters: null,
        scope: {
          scopeKind: 'selected_task',
          title: 'Task',
          subject: 'task',
          name: 'Verify deliverable',
          banner: 'Task: Verify deliverable',
        },
        onTabChange: vi.fn(),
        onClearWorkItemScope: vi.fn(),
        onClearTaskScope: vi.fn(),
        onOpenAddWork: vi.fn(),
        onOpenRedrive: vi.fn(),
        onLoadMoreActivity: vi.fn(),
        onLoadMoreDeliverables: vi.fn(),
      }),
    );

    expect(html).toContain('Task: Verify deliverable');
    expect(html).toContain('Live Console');
    expect(html).not.toContain('this workflow yet');
  });

  it('derives the visible scope indicator and tab badges from the scoped packet when outer props are stale', () => {
    const packet = createPacket();
    const html = renderToStaticMarkup(
      createElement(WorkflowBottomWorkbench, {
        workflowId: 'workflow-1',
        workflow: packet.workflow,
        stickyStrip: packet.sticky_strip,
        board: packet.board,
        workflowName: 'Workflow 1',
        packet: {
          ...packet,
          selected_scope: {
            scope_kind: 'selected_task',
            work_item_id: 'work-item-7',
            task_id: 'task-3',
          },
          bottom_tabs: {
            ...packet.bottom_tabs,
            current_scope_kind: 'selected_task',
            current_work_item_id: 'work-item-7',
            current_task_id: 'task-3',
            counts: {
              details: 41,
              needs_action: 42,
              steering: 43,
              live_console_activity: 44,
              history: 45,
              deliverables: 46,
            },
          },
        },
        activeTab: 'live_console',
        selectedWorkItemId: null,
        scopedWorkItemId: null,
        selectedWorkItemTitle: 'Prepare release bundle',
        selectedTaskId: null,
        selectedTaskTitle: 'Verify deliverable',
        selectedWorkItem: null,
        selectedTask: null,
        selectedWorkItemTasks: [],
        inputPackets: [],
        workflowParameters: null,
        scope: {
          scopeKind: 'workflow',
          title: 'Workflow',
          subject: 'workflow',
          name: 'Workflow 1',
          banner: 'Workflow: Workflow 1',
        },
        onTabChange: vi.fn(),
        onClearWorkItemScope: vi.fn(),
        onClearTaskScope: vi.fn(),
        onOpenAddWork: vi.fn(),
        onOpenRedrive: vi.fn(),
        onLoadMoreActivity: vi.fn(),
        onLoadMoreDeliverables: vi.fn(),
      }),
    );

    expect(html).toContain('Showing Task');
    expect(html).toContain('Verify deliverable');
    expect(html).toContain('Show work item');
    expect(html).toContain('Show workflow');
    expect(html).toContain('>42<');
    expect(html).toContain('>45<');
    expect(html).not.toContain('>41<');
    expect(html).not.toContain('Workflow: Workflow 1');
    expect(html).toContain('Live Console');
    expect(html).not.toContain('this workflow yet');
  });

  it('prefers the scoped live-console total count over the paged 50-row window in the tab badge', () => {
    const packet = createPacket();
    const html = renderToStaticMarkup(
      createElement(WorkflowBottomWorkbench, {
        workflowId: 'workflow-1',
        workflow: packet.workflow,
        stickyStrip: packet.sticky_strip,
        board: packet.board,
        workflowName: 'Workflow 1',
        packet: {
          ...packet,
          bottom_tabs: {
            ...packet.bottom_tabs,
            counts: {
              ...packet.bottom_tabs.counts,
              live_console_activity: 50,
            },
          },
          live_console: {
            ...packet.live_console,
            total_count: 137,
          },
        },
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
        scope: {
          scopeKind: 'workflow',
          title: 'Workflow',
          subject: 'workflow',
          name: 'Workflow 1',
          banner: 'Workflow: Workflow 1',
        },
        onTabChange: vi.fn(),
        onClearWorkItemScope: vi.fn(),
        onClearTaskScope: vi.fn(),
        onOpenAddWork: vi.fn(),
        onOpenRedrive: vi.fn(),
        onLoadMoreActivity: vi.fn(),
        onLoadMoreDeliverables: vi.fn(),
      }),
    );

    expect(html).toContain('>137<');
    expect(html).not.toContain('>50<');
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
