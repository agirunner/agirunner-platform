import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './workflow-inspector-page.tsx'), 'utf8');
}

describe('workflow inspector page source', () => {
  it('adds a workflow-scoped inspector entry shell around the shared log surface', () => {
    const source = readSource();
    expect(source).toContain('useParams');
    expect(source).toContain('dashboardApi.getWorkflow');
    expect(source).toContain('Workflow Inspector');
    expect(source).toContain('Workflow Board');
    expect(source).toContain('Current operator scope');
    expect(source).toContain('InspectorMetric');
    expect(source).toContain('workflowId');
    expect(source).toContain('LogsSurface');
    expect(source).toContain('scopedWorkflowId={workflowId}');
  });
});
