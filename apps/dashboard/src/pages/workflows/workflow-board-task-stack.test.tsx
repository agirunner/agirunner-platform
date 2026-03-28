import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { WorkflowBoardTaskStack } from './workflow-board-task-stack.js';

describe('WorkflowBoardTaskStack', () => {
  it('renders the full task stack instead of truncating after a small preview', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowBoardTaskStack, {
        tasks: [
          { id: 'task-1', title: 'First task', role: 'orchestrator', state: 'completed' },
          { id: 'task-2', title: 'Second task', role: 'analyst', state: 'completed' },
          { id: 'task-3', title: 'Third task', role: 'reviewer', state: 'failed' },
          { id: 'task-4', title: 'Fourth task', role: 'assessor', state: 'in_progress' },
        ],
      }),
    );

    expect(html).toContain('4 tasks');
    expect(html).toContain('First task');
    expect(html).toContain('Second task');
    expect(html).toContain('Third task');
    expect(html).toContain('Fourth task');
  });
});
