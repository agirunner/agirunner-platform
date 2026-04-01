import { describe, expect, it } from 'vitest';

import { createWorkflowCard, renderWorkflowStateStrip } from './workflow-state-strip.test-support.js';

describe('WorkflowStateStrip layout', () => {
  it('shows the ongoing lifecycle badge in the playbook metadata row', () => {
    const html = renderWorkflowStateStrip({
      workflow: createWorkflowCard({
        lifecycle: 'ongoing',
      }),
    });

    expect(html).toContain('data-workflow-header-meta="true"');
    expect(html).toMatch(/data-workflow-header-meta="true"[\s\S]*>Ongoing</);
  });
});
