import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { WorkflowBoardTaskStack } from './workflow-board-task-stack.js';

describe('WorkflowBoardTaskStack', () => {
  it('humanizes task states for operator readability', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowBoardTaskStack, {
        tasks: [
          {
            id: 'task-1',
            title: 'Assess packet',
            role: 'policy-assessor',
            state: 'in_progress',
          },
        ],
      }),
    );

    expect(html).toContain('Policy Assessor • In Progress');
    expect(html).not.toContain('policy-assessor • in_progress');
  });

  it('does not auto-open unrelated task stacks when another task is selected elsewhere', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowBoardTaskStack, {
        tasks: [
          {
            id: 'task-1',
            title: 'Assess packet',
            role: 'policy-assessor',
            state: 'in_progress',
          },
        ],
        selectedTaskId: 'task-elsewhere',
        defaultOpen: false,
      }),
    );

    expect(html).not.toContain('open=""');
  });

  it('opens the stack when it contains the selected task', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowBoardTaskStack, {
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

    expect(html).toContain('open=""');
  });
});
