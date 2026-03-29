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
    expect(html).toContain('Scope');
    expect(html).toContain('>Workflow<');
    expect(html).toContain('grid h-full min-h-[22rem] min-w-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-2 overflow-hidden px-1 py-1 lg:min-h-0');
    expect(html).toContain('flex min-w-0 flex-wrap items-start justify-between gap-2 px-2 py-1.5');
    expect(html).not.toContain('rounded-xl border border-border/70 bg-transparent px-3 py-2');
    expect(html).not.toContain('rounded-2xl border border-border/70 bg-background/90 p-2.5 shadow-sm');
    expect(html).not.toContain('rounded-2xl bg-background/90 p-2.5');
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

  it('collapses task-scoped packets back to the parent work item in the workbench header', () => {
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

    expect(html).toContain('Work item: Prepare release bundle');
    expect(html).toContain('Prepare release bundle');
    expect(html).toContain('Scope');
    expect(html).toContain('>Work item<');
    expect(html).toContain('Show workflow');
    expect(html).not.toContain('Task: Verify deliverable');
    expect(html).not.toContain('>Task<');
    expect(html).not.toContain('Show work item');
    expect(html).not.toContain('Selected on board');
    expect(html).not.toContain('Back to work item');
    expect(html).not.toContain('Back to workflow');
    expect(html).not.toContain('Workflow 1</h3>');
    expect(html).not.toContain('Current scope');
  });

  it('uses the resolved current work-item and task records when details scope moves ahead of outer props', () => {
    const packet = createPacket();
    const html = renderToStaticMarkup(
      createElement(WorkflowBottomWorkbench, {
        workflowId: 'workflow-1',
        workflow: packet.workflow,
        stickyStrip: packet.sticky_strip,
        board: {
          columns: packet.board?.columns ?? [],
          work_items: [
            {
              id: 'work-item-7',
              workflow_id: 'workflow-1',
              stage_name: 'release',
              title: 'Prepare release bundle',
              goal: 'Assemble final artifacts for launch.',
              column_id: 'in_progress',
              priority: 'normal',
            },
          ],
          active_stages: packet.board?.active_stages ?? [],
          awaiting_gate_count: packet.board?.awaiting_gate_count ?? 0,
          stage_summary: packet.board?.stage_summary ?? [],
        },
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
        selectedWorkItemId: null,
        scopedWorkItemId: null,
        selectedWorkItemTitle: null,
        selectedTaskId: null,
        selectedTaskTitle: null,
        selectedWorkItem: null,
        selectedTask: null,
        selectedWorkItemTasks: [
          {
            id: 'task-3',
            title: 'Verify deliverable',
            role: 'reviewer',
            state: 'in_progress',
            work_item_id: 'work-item-7',
            work_item_title: 'Prepare release bundle',
            input: {
              deliverable: 'Confirm the final release packet is complete and operator-ready.',
            },
          },
        ],
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

    expect(html).toContain('Prepare release bundle');
    expect(html).toContain('Assemble final artifacts for launch.');
    expect(html).toContain('1 active task');
    expect(html).not.toContain('1 active • 0 blocked • 0 completed');
    expect(html).toContain('Verify deliverable');
    expect(html).toContain('Reviewer');
    expect(html).toContain('In Progress');
    expect(html).not.toContain('Requested deliverable');
    expect(html).not.toContain('Task details are loading.');
  });

  it('shows the work item scope banner above the tabs when the workbench is scoped to a work item', () => {
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
            scope_kind: 'selected_work_item',
            work_item_id: 'work-item-7',
            task_id: null,
          },
          bottom_tabs: {
            ...packet.bottom_tabs,
            current_scope_kind: 'selected_work_item',
            current_work_item_id: 'work-item-7',
            current_task_id: null,
          },
        },
        activeTab: 'details',
        selectedWorkItemId: 'work-item-7',
        scopedWorkItemId: 'work-item-7',
        selectedWorkItemTitle: 'Prepare release bundle',
        selectedTaskId: null,
        selectedTaskTitle: null,
        selectedWorkItem: null,
        selectedTask: null,
        selectedWorkItemTasks: [],
        inputPackets: [],
        workflowParameters: null,
        scope: {
          scopeKind: 'selected_work_item',
          title: 'Work item',
          subject: 'work item',
          name: 'Prepare release bundle',
          banner: 'Work item: Prepare release bundle',
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

    expect(html).toContain('Scope');
    expect(html).toContain('>Work item<');
    expect(html).toContain('Work item: Prepare release bundle');
    expect(html.indexOf('Work item: Prepare release bundle')).toBeLessThan(html.indexOf('Details'));
    expect(html).toContain('Show workflow');
    expect(html).not.toContain('Show work item');
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

  it('locks steering to the parent work item when the packet arrives task-scoped', () => {
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
          activeTab: 'steering',
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
      ),
    );

    expect(html).toContain('Targeting work item: Prepare release bundle');
  });

  it('renders the live console empty state for the normalized work-item scope shown in the banner', () => {
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

    expect(html).toContain('Work item: Prepare release bundle');
    expect(html).toContain('Live Console');
    expect(html).toContain('Scope');
    expect(html).not.toContain('this workflow yet');
  });

  it('shows a loading state for the normalized work-item live console while scope data refetches', () => {
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
          live_console: {
            ...packet.live_console,
            total_count: 0,
            items: [],
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
        isScopeLoading: true,
        onTabChange: vi.fn(),
        onClearWorkItemScope: vi.fn(),
        onClearTaskScope: vi.fn(),
        onOpenAddWork: vi.fn(),
        onOpenRedrive: vi.fn(),
        onLoadMoreActivity: vi.fn(),
        onLoadMoreDeliverables: vi.fn(),
      }),
    );

    expect(html).toContain('Loading live console for Work item: Prepare release bundle.');
    expect(html).not.toContain('No live console entries recorded for Work item: Prepare release bundle yet.');
    expect(html).not.toContain('data-live-console-filter="all"');
  });

  it('derives the visible work-item scope indicator and tab badges from the scoped packet when outer props are stale', () => {
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

    expect(html).toContain('Scope');
    expect(html).toContain('>Work item<');
    expect(html).toContain('Prepare release bundle');
    expect(html).not.toContain('Show work item');
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

  it('keeps the lower tab frame as a stretching flex column so the live console can fill it', () => {
    const packet = createPacket();
    const html = renderToStaticMarkup(
      createElement(WorkflowBottomWorkbench, {
        workflowId: 'workflow-1',
        workflow: packet.workflow,
        stickyStrip: packet.sticky_strip,
        board: packet.board,
        workflowName: 'Workflow 1',
        packet,
        activeTab: 'live_console',
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

    expect(html).toContain('flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden');
    expect(html).toContain('flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-3 py-3');
    expect(html).not.toContain('rounded-[1.25rem] border border-border/60 bg-background/70');
    expect(html).not.toContain('min-h-0 min-w-0 flex-1 overflow-auto');
  });

  it('keeps non-console tabs inside the same full-height lower frame with their own internal scroll area', () => {
    const packet = createPacket();
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

    expect(html).toContain('flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden');
    expect(html).toContain('min-h-0 min-w-0 flex-1 overflow-y-auto px-3 py-3');
    expect(html).not.toContain('rounded-[1.25rem] border border-border/60 bg-background/70');
  });

  it('renders the deliverables tab even when the scoped deliverables packet is incomplete', () => {
    const packet = createPacket();

    expect(() =>
      renderToStaticMarkup(
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
                deliverables: 1,
              },
            },
            deliverables: {
              final_deliverables: [
                {
                  descriptor_id: 'deliverable-incomplete',
                  workflow_id: 'workflow-1',
                  work_item_id: null,
                  title: 'Recovered deliverable',
                  content_preview: {
                    summary: 'Deliverables tab should render instead of tripping the workspace fallback.',
                  },
                },
              ],
              inputs_and_provenance: null,
            } as unknown as DashboardWorkflowWorkspacePacket['deliverables'],
          },
          activeTab: 'deliverables',
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
    ).not.toThrow();

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
              deliverables: 1,
            },
          },
          deliverables: {
            final_deliverables: [
              {
                descriptor_id: 'deliverable-incomplete',
                workflow_id: 'workflow-1',
                work_item_id: null,
                title: 'Recovered deliverable',
                content_preview: {
                  summary: 'Deliverables tab should render instead of tripping the workspace fallback.',
                },
              },
            ],
            inputs_and_provenance: null,
          } as unknown as DashboardWorkflowWorkspacePacket['deliverables'],
        },
        activeTab: 'deliverables',
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

    expect(html).toContain('Deliverables');
    expect(html).toContain('Recovered deliverable');
    expect(html).toContain('Deliverables tab should render instead of tripping the workspace fallback.');
    expect(html).toContain('No inputs or intervention files are attached to this workflow.');
  });

  it('keeps deliverables aligned with the normalized work-item scope when outer props are stale', () => {
    const packet = createPacket();
    const html = renderToStaticMarkup(
      createElement(WorkflowBottomWorkbench, {
        workflowId: 'workflow-1',
        workflow: packet.workflow,
        stickyStrip: packet.sticky_strip,
        board: {
          columns: packet.board?.columns ?? [],
          work_items: [
            {
              id: 'work-item-7',
              workflow_id: 'workflow-1',
              stage_name: 'release',
              title: 'Prepare release bundle',
              goal: 'Assemble final artifacts for launch.',
              column_id: 'in_progress',
              priority: 'normal',
            },
          ],
          active_stages: packet.board?.active_stages ?? [],
          awaiting_gate_count: packet.board?.awaiting_gate_count ?? 0,
          stage_summary: packet.board?.stage_summary ?? [],
        },
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
          deliverables: {
            ...packet.deliverables,
            final_deliverables: [
              {
                descriptor_id: 'deliverable-1',
                workflow_id: 'workflow-1',
                work_item_id: 'work-item-7',
                descriptor_kind: 'artifact',
                delivery_stage: 'final',
                title: 'Release checklist',
                state: 'final',
                summary_brief: 'Operator-ready release checklist.',
                preview_capabilities: {},
                primary_target: {
                  target_kind: 'artifact',
                  label: 'Open artifact in new tab',
                  url: '/api/v1/tasks/task-3/artifacts/artifact-1/preview',
                },
                secondary_targets: [],
                content_preview: {
                  summary: 'Checklist is ready for the operator.',
                },
                source_brief_id: null,
                created_at: '2026-03-28T03:00:00.000Z',
                updated_at: '2026-03-28T03:00:00.000Z',
              },
            ],
          },
        },
        activeTab: 'deliverables',
        selectedWorkItemId: null,
        scopedWorkItemId: null,
        selectedWorkItemTitle: null,
        selectedTaskId: null,
        selectedTaskTitle: null,
        selectedWorkItem: null,
        selectedTask: null,
        selectedWorkItemTasks: [
          {
            id: 'task-3',
            title: 'Verify deliverable',
            role: 'reviewer',
            state: 'in_progress',
            work_item_id: 'work-item-7',
            work_item_title: 'Prepare release bundle',
            output: {
              summary: 'Task evidence should stay visible while task details refetch.',
            },
          },
        ],
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

    expect(html).toContain('Work item deliverables (1)');
    expect(html).toContain('Release checklist');
    expect(html).not.toContain('Task output and evidence');
    expect(html).not.toContain('Parent work item deliverables (1)');
  });

  it('renders embedded text-only deliverables inline when task-scoped packets normalize to work-item deliverables', () => {
    const packet = createPacket();
    const html = renderToStaticMarkup(
      createElement(WorkflowBottomWorkbench, {
        workflowId: 'workflow-1',
        workflow: packet.workflow,
        stickyStrip: packet.sticky_strip,
        board: {
          columns: packet.board?.columns ?? [],
          work_items: [
            {
              id: 'work-item-7',
              workflow_id: 'workflow-1',
              stage_name: 'release',
              title: 'Prepare release bundle',
              goal: 'Assemble final artifacts for launch.',
              column_id: 'in_progress',
              priority: 'normal',
            },
          ],
          active_stages: packet.board?.active_stages ?? [],
          awaiting_gate_count: packet.board?.awaiting_gate_count ?? 0,
          stage_summary: packet.board?.stage_summary ?? [],
        },
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
          deliverables: {
            ...packet.deliverables,
            final_deliverables: [
              {
                descriptor_id: 'deliverable-embedded-text',
                workflow_id: 'workflow-1',
                work_item_id: 'work-item-7',
                descriptor_kind: 'handoff_packet',
                delivery_stage: 'final',
                title: 'Release summary packet',
                state: 'final',
                summary_brief: null,
                preview_capabilities: {},
                primary_target: {} as never,
                secondary_targets: [],
                content_preview: {
                  summary: 'Embedded release summary without a target URL.',
                },
                source_brief_id: null,
                created_at: '2026-03-28T03:00:00.000Z',
                updated_at: '2026-03-28T03:00:00.000Z',
              },
            ],
          },
        },
        activeTab: 'deliverables',
        selectedWorkItemId: null,
        scopedWorkItemId: null,
        selectedWorkItemTitle: null,
        selectedTaskId: null,
        selectedTaskTitle: null,
        selectedWorkItem: null,
        selectedTask: null,
        selectedWorkItemTasks: [
          {
            id: 'task-3',
            title: 'Verify deliverable',
            role: 'reviewer',
            state: 'in_progress',
            work_item_id: 'work-item-7',
            work_item_title: 'Prepare release bundle',
            output: {
              summary: 'Task evidence should stay visible while task details refetch.',
            },
          },
        ],
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

    expect(html).toContain('Release summary packet');
    expect(html).toContain('Embedded release summary without a target URL.');
    expect(html).toContain('Work item deliverables (1)');
    expect(html).not.toContain('Open artifact in new tab');
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
