import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { TaskGraphCard } from './workflow-detail-task-graph-card.js';

describe('workflow detail task graph card', () => {
  it('renders grouped execution steps with readable upstream and timing details', () => {
    const tasks = [
      {
        id: 'task-parent',
        title: 'Build release candidate',
        state: 'completed',
        depends_on: [],
      },
      {
        id: 'task-child',
        title: 'Review release candidate',
        state: 'in_progress',
        depends_on: ['task-parent'],
        role: 'reviewer',
        stage_name: 'review',
        created_at: '2026-03-12T11:45:00.000Z',
      },
    ];
    const markup = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(TaskGraphCard, {
          tasks,
          stageGroups: [{ stageName: 'review', tasks: [tasks[1]] }],
          isLoading: false,
          hasError: false,
        }),
      ),
    );

    expect(markup).toContain('Execution Steps');
    expect(markup).toContain('Review release candidate');
    expect(markup).toContain('reviewer • stage review');
    expect(markup).toContain('Build release candidate');
    expect(markup).toContain('Queued');
  });
});
