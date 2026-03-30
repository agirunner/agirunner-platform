import { describe, expect, it } from 'vitest';

import { createPacket, renderWorkbench } from './workflow-bottom-workbench.test-support.js';

describe('WorkflowBottomWorkbench live console', () => {
  it('renders the live console empty state for the normalized work-item scope shown in the banner', () => {
    const packet = createPacket();
    const html = renderWorkbench({
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
      scope: {
        scopeKind: 'selected_work_item',
        title: 'Work item',
        subject: 'work item',
        name: 'Verify deliverable',
        banner: 'Work item: Verify deliverable',
      },
    });

    expect(html).toContain('Work item · Prepare release bundle');
    expect(html).toContain('Live Console');
    expect(html).not.toContain('this workflow yet');
  });

  it('shows a loading state for the normalized work-item live console while scope data refetches', () => {
    const packet = createPacket();
    const html = renderWorkbench({
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
      scope: {
        scopeKind: 'selected_work_item',
        title: 'Work item',
        subject: 'work item',
        name: 'Verify deliverable',
        banner: 'Work item: Verify deliverable',
      },
      isScopeLoading: true,
    });

    expect(html).toContain('Loading live console for Work item · Prepare release bundle.');
    expect(html).not.toContain(
      'No live console entries recorded for Work item · Prepare release bundle yet.',
    );
    expect(html).not.toContain('data-live-console-filter="all"');
  });

  it('derives the visible work-item scope indicator and tab badges from the scoped packet when outer props are stale', () => {
    const packet = createPacket();
    const html = renderWorkbench({
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
            briefs: 0,
            history: 45,
            deliverables: 46,
          },
        },
      },
      activeTab: 'live_console',
      selectedWorkItemTitle: 'Prepare release bundle',
    });

    expect(html).toContain('Work item · Prepare release bundle');
    expect(html).toContain('Show workflow');
    expect(html).toContain('>42<');
    expect(html).toContain('>44<');
    expect(html).not.toContain('>41<');
    expect(html).not.toContain('>45<');
    expect(html).toContain('Live Console');
  });

  it('prefers the scoped live-console total count over the paged 50-row window in the tab badge', () => {
    const packet = createPacket();
    const html = renderWorkbench({
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
    });

    expect(html).toContain('>137<');
    expect(html).not.toContain('>50<');
  });

  it('keeps the lower tab frame as a stretching flex column so the live console can fill it', () => {
    const html = renderWorkbench({
      activeTab: 'live_console',
    });

    expect(html).toContain('flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden');
    expect(html).toContain('flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-4 py-4');
    expect(html).toContain(
      'gap-1.5 overflow-x-auto px-3 pb-2.5 pt-2 sm:flex-wrap sm:overflow-visible',
    );
  });

  it('keeps non-console tabs inside the same full-height lower frame with their own internal scroll area', () => {
    const html = renderWorkbench();

    expect(html).toContain('flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden');
    expect(html).toContain('flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-4 py-4');
    expect(html).not.toContain('flex min-h-full min-w-0 flex-1 flex-col');
  });
});
