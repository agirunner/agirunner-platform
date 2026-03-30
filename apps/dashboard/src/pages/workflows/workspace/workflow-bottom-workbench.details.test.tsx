import { describe, expect, it } from 'vitest';

import { createPacket, renderWorkbench } from './workflow-bottom-workbench.test-support.js';

describe('WorkflowBottomWorkbench details', () => {
  it('collapses task-scoped packets back to the parent work item in the workbench header', () => {
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

    expect(html).toContain('Work item · Prepare release bundle');
    expect(html).toContain('Prepare release bundle');
    expect(html).toContain('Show workflow');
    expect(html).not.toContain('Task · Verify deliverable');
    expect(html).not.toContain('Show work item');
  });

  it('uses the resolved current work-item and task records when details scope moves ahead of outer props', () => {
    const packet = createPacket();
    const html = renderWorkbench({
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
    });

    expect(html).toContain('Prepare release bundle');
    expect(html).toContain('Assemble final artifacts for launch.');
    expect(html).toContain('1 active task');
    expect(html).toContain('What was asked');
    expect(html).toContain('Verify deliverable:');
    expect(html).toContain('Requested deliverable');
    expect(html).toContain('Confirm the final release packet is complete and operator-ready.');
    expect(html).toContain('Verify deliverable');
    expect(html).toContain('Reviewer');
    expect(html).toContain('In Progress');
    expect(html).not.toContain('Task details are loading.');
  });
});
