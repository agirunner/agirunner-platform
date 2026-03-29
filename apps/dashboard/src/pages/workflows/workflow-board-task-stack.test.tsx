import { isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { WorkflowBoardTaskStack } from './workflow-board-task-stack.js';

describe('WorkflowBoardTaskStack', () => {
  it('makes the full task area reselect the parent work item in work-item view', () => {
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
    expect(element.type).toBe('button');
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
    expect(html).toContain('data-work-item-task-area="true"');
    expect(html).toContain('data-work-item-task-row="true"');
    expect(html).not.toContain('data-task-selectable="true"');
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
    expect(html).toContain('rounded-md border border-border/50 bg-background/30');
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
