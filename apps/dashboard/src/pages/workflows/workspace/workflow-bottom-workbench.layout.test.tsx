import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createPacket,
  createWorkbenchProps,
  renderWorkbench,
} from './workflow-bottom-workbench.test-support.js';

function readWorkbenchSource() {
  return readFileSync(resolve(import.meta.dirname, './workflow-bottom-workbench.tsx'), 'utf8');
}

describe('WorkflowBottomWorkbench layout', () => {
  it('keeps the workbench component workflow/work-item only with no selected-task props or task scope state', () => {
    const source = readWorkbenchSource();

    expect(source).not.toContain('selectedTaskId?:');
    expect(source).not.toContain('selectedTaskTitle?:');
    expect(source).not.toContain('selectedTask?:');
    expect(source).not.toContain('current_task_id');
    expect(source).not.toContain("scopeKind === 'selected_task'");
    expect(source).not.toContain('resolveScopedTaskRecord(');
  });

  it('renders a compact scope header above the tabs and keeps only the locked shell tabs', () => {
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
    const html = renderWorkbench({
      packet,
    });

    expect(html).toContain('>Workflow<');
    expect(html.indexOf('>Workflow<')).toBeLessThan(html.indexOf('Details'));
    expect(html).toContain(
      'grid h-full min-h-0 min-w-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-0 overflow-hidden',
    );
    expect(html).toContain('border-b border-border/60 bg-muted/20 px-3 py-3');
    expect(html).toContain('flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-4 py-4');
    expect(html).toContain('Needs Action</span><div');
    expect(html).toContain('>Live Console<');
    expect(html).toContain('>Deliverables<');
    expect(html).not.toContain('>History<');
    expect(html).not.toContain('Steering</span><div');
    expect(html).not.toContain('Scope');
  });

  it('shows the work item scope banner above the tabs when the lower pane is scoped to a work item', () => {
    const packet = createPacket();
    const html = renderWorkbench({
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
      selectedWorkItemId: 'work-item-7',
      scopedWorkItemId: 'work-item-7',
      selectedWorkItemTitle: 'Prepare release bundle',
      scope: {
        scopeKind: 'selected_work_item',
        title: 'Work item',
        subject: 'work item',
        name: 'Prepare release bundle',
        banner: 'Work item: Prepare release bundle',
      },
    });

    expect(html).toContain('Work item · Prepare release bundle');
    expect(html.indexOf('Work item · Prepare release bundle')).toBeLessThan(
      html.indexOf('Details'),
    );
    expect(html).toContain('Show workflow');
    expect(html).not.toContain('Show work item');
  });

  it('does not render the legacy steering composer inside details after the steering tab is removed', () => {
    const packet = createPacket();
    const html = renderWorkbench({
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
    });

    expect(html).toContain('>Workflow<');
    expect(html).toContain('border-b border-border/60 bg-muted/20 px-3 py-3');
    expect(html).not.toContain('Steering request');
    expect(html).not.toContain('Steering history');
    expect(html).not.toContain('Steering</span><div');
  });

  it('locks steering to the parent work item when the packet arrives task-scoped', () => {
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
        },
      },
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

    expect(html).not.toContain('Targeting work item: Prepare release bundle');
    expect(html).not.toContain('Steering</span><div');
  });
});
