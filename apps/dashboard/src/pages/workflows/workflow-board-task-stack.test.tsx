import { isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { WorkflowBoardTaskStack } from './workflow-board-task-stack.js';

describe('WorkflowBoardTaskStack', () => {
  it('makes the full task area reselect the parent work item in work-item view without using an invalid button wrapper', () => {
    const onSelectWorkItem = vi.fn();
    const element = WorkflowBoardTaskStack({
      tasks: [
        {
          id: 'task-1',
          title: 'Assess packet',
          role: 'policy-assessor',
          state: 'in_progress',
        },
      ],
      collapsible: false,
      onSelectWorkItem,
    });

    expect(isValidElement(element)).toBe(true);
    expect(element.type).toBe('div');
    expect(element.props.role).toBe('button');
    expect(element.props.tabIndex).toBe(0);
    expect(element.props['data-work-item-task-area']).toBe('true');

    element.props.onClick();
    element.props.onKeyDown({ key: 'Enter', preventDefault: vi.fn() });
    element.props.onKeyDown({ key: ' ', preventDefault: vi.fn() });

    expect(onSelectWorkItem).toHaveBeenCalledTimes(3);
  });

  it('keeps the selected work-item stack collapsible, open by default, and parent-selectable', () => {
    const onSelectWorkItem = vi.fn();
    const element = WorkflowBoardTaskStack({
      tasks: [
        {
          id: 'task-1',
          title: 'Assess packet',
          role: 'policy-assessor',
          state: 'in_progress',
        },
      ],
      defaultOpen: true,
      collapsible: true,
      onSelectWorkItem,
    });

    expect(isValidElement(element)).toBe(true);
    expect(element.type).toBe('details');
    expect(element.props.open).toBe(true);
    expect(element.props['data-work-item-task-area']).toBe('true');

    element.props.onClick();

    expect(onSelectWorkItem).toHaveBeenCalledOnce();
  });

  it('keeps task rows operator-readable inside the work-item task area', () => {
    const html = renderToStaticMarkup(
      WorkflowBoardTaskStack({
        tasks: [
          {
            id: 'task-1',
            title: 'Assess packet',
            role: 'policy-assessor',
            state: 'in_progress',
            recentUpdate: 'Reviewing the packet before handing it off.',
            operatorSummary: [
              'Requested deliverable: Confirm the approval packet is complete.',
              'Success criteria: Capture open risks before the final handoff.',
            ],
          },
          {
            id: 'task-2',
            title: 'Review approval packet',
            role: 'mixed-reviewer',
            state: 'ready',
            recentUpdate: 'Queued once the assessor finishes.',
          },
        ],
        collapsible: false,
        onSelectWorkItem: () => undefined,
      }),
    );

    expect(html).toContain('Tasks');
    expect(html).toContain('Working now');
    expect(html).toContain('Policy Assessor • In Progress');
    expect(html).toContain('Ready next');
    expect(html).toContain('Queued once the assessor finishes.');
    expect(html).toContain('Requested deliverable: Confirm the approval packet is complete.');
    expect(html).toContain('Success criteria: Capture open risks before the final handoff.');
    expect(html).toContain('data-work-item-task-area="true"');
    expect(html).toContain('data-work-item-task-row="true"');
    expect(html).not.toContain('data-task-selectable="true"');
  });

  it('drops the redundant task-stack shell while keeping per-task rows visible', () => {
    const html = renderToStaticMarkup(
      WorkflowBoardTaskStack({
        tasks: [
          {
            id: 'task-1',
            title: 'Assess packet',
            role: 'policy-assessor',
            state: 'in_progress',
          },
          {
            id: 'task-2',
            title: 'Review packet',
            role: 'mixed-reviewer',
            state: 'ready',
          },
        ],
        collapsible: false,
        onSelectWorkItem: () => undefined,
      }),
    );

    expect(html).toContain('data-work-item-task-area="true"');
    expect(html).toContain('data-work-item-task-row="true"');
    expect(html).toContain('Working now');
    expect(html).toContain('Ready next');
    expect(html).not.toContain('rounded-lg border border-border/60 bg-muted/5 p-2.5');
    expect(html).not.toContain('rounded-md border border-border/50 bg-background/30');
  });

  it('bounds large task lists with an internal themed scroll treatment', () => {
    const html = renderToStaticMarkup(
      WorkflowBoardTaskStack({
        tasks: Array.from({ length: 6 }, (_, index) => ({
          id: `task-${index + 1}`,
          title: `Task ${index + 1}`,
          role: 'policy-assessor',
          state: index === 0 ? 'in_progress' : 'ready',
        })),
        collapsible: false,
        onSelectWorkItem: () => undefined,
      }),
    );

    expect(html).toContain('max-h-[16rem] overflow-y-auto overscroll-contain pr-1');
    expect(html).toContain('scrollbar-width:thin');
    expect(html).not.toContain('rounded-md border border-border/50 bg-background/30');
  });

  it('shows a taller in-card task viewport when the lane only has a single work item', () => {
    const html = renderToStaticMarkup(
      WorkflowBoardTaskStack({
        tasks: Array.from({ length: 6 }, (_, index) => ({
          id: `task-${index + 1}`,
          title: `Task ${index + 1}`,
          role: 'policy-assessor',
          state: index === 0 ? 'in_progress' : 'ready',
        })),
        collapsible: true,
        laneWorkItemCount: 1,
      }),
    );

    expect(html).toContain('max-h-[22rem] overflow-y-auto overscroll-contain pr-1');
    expect(html).toContain('scrollbar-width:thin');
    expect(html).not.toContain('max-h-[16rem] overflow-y-auto overscroll-contain pr-1');
  });

  it('does not auto-open collapsed stacks from stale selected-task state anymore', () => {
    const html = renderToStaticMarkup(
      WorkflowBoardTaskStack({
        tasks: [
          {
            id: 'task-1',
            title: 'Assess packet',
            role: 'policy-assessor',
            state: 'in_progress',
          },
        ],
        selectedTaskId: 'task-1',
        defaultOpen: false,
      }),
    );

    expect(html).not.toContain('open=""');
  });
});
