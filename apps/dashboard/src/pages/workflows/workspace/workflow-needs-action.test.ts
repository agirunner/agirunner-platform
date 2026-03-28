import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { WorkflowNeedsAction } from './workflow-needs-action.js';

describe('WorkflowNeedsAction', () => {
  it('renders nested action targets without crashing', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowNeedsAction, {
        packet: {
          items: [
            {
              action_id: 'workflow-1:pause_workflow',
              action_kind: 'pause_workflow',
              label: 'Pause Workflow',
              summary: 'Pause the workflow safely.',
              target: {
                target_kind: 'workflow',
                target_id: 'workflow-1',
              },
              priority: 'medium',
              requires_confirmation: false,
              submission: {
                route_kind: 'workflow_intervention',
                method: 'POST',
              },
            },
          ],
          total_count: 1,
          default_sort: 'priority_desc',
        },
        onOpenAddWork: vi.fn(),
        onOpenRedrive: vi.fn(),
        onOpenSteering: vi.fn(),
      }),
    );

    expect(html).toContain('Pause Workflow');
    expect(html).toContain('Workflow');
    expect(html).toContain('Medium priority');
  });
});
