import { describe, expect, it } from 'vitest';

import { renderWorkbench } from './workflow-bottom-workbench.test-support.js';

describe('WorkflowBottomWorkbench layout', () => {
  it('renders the workbench selectors as accessible tabs', () => {
    const html = renderWorkbench();

    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Workflow workbench tabs"');
    expect(html).toContain('role="tab"');
    expect(html).toContain('aria-controls="workflow-workbench-panel-details"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain('aria-labelledby="workflow-workbench-tab-details"');
    expect(html).toContain('data-workflows-workbench-panel="details"');
  });
});
