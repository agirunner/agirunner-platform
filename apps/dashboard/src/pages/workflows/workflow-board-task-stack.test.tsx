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
