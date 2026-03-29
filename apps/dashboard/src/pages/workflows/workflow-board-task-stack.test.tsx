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

    expect(html).toContain('Tasks');
    expect(html).not.toContain('Task stack');
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

  it('renders readable non-interactive task summaries when task selection is locked to work-item view', () => {
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
        collapsible: false,
        defaultOpen: true,
      }),
    );

    expect(html).toContain('Assess packet');
    expect(html).not.toContain('<details');
    expect(html).not.toContain('<summary');
    expect(html).not.toContain('<button');
  });

  it('surfaces active task ownership and task-ready context in non-interactive work-item rows', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowBoardTaskStack, {
        tasks: [
          {
            id: 'task-1',
            title: 'Assess packet',
            role: 'policy-assessor',
            state: 'in_progress',
            recentUpdate: 'Reviewing the latest packet before filing the handoff.',
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
        defaultOpen: true,
      }),
    );

    expect(html).toContain('Working now');
    expect(html).toContain('Reviewing the latest packet before filing the handoff.');
    expect(html).toContain('Ready next');
    expect(html).toContain('Queued once the assessor finishes.');
    expect(html).not.toContain('<button');
  });

  it('does not keep a stale task highlight when task selection is locked to work-item view', () => {
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
        defaultOpen: true,
      }),
    );

    expect(html).toContain('Assess packet');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('border-amber-300 bg-amber-100/90');
  });
});
