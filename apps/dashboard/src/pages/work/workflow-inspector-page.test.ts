import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return [
    './workflow-inspector-page.tsx',
    './workflow-inspector-page.sections.tsx',
    './workflow-inspector-support.ts',
  ]
    .map((path) => readFileSync(resolve(import.meta.dirname, path), 'utf8'))
    .join('\n');
}

describe('workflow inspector page source', () => {
  it('adds a workflow-scoped inspector entry shell around the shared log surface', () => {
    const source = readSource();
    expect(source).toContain('useParams');
    expect(source).toContain('dashboardApi.getWorkflow');
    expect(source).toContain('dashboardApi.getProject');
    expect(source).toContain('dashboardApi.getLogStats');
    expect(source).toContain('dashboardApi.getWorkflowWorkItemMemoryHistory');
    expect(source).toContain('Workflow Inspector');
    expect(source).toContain('Workflow Board');
    expect(source).toContain('Current operator scope');
    expect(source).toContain('Operator focus');
    expect(source).toContain('Best next step:');
    expect(source).toContain('Trace coverage');
    expect(source).toContain('WorkflowInspectorTelemetryPanel');
    expect(source).toContain('telemetry={telemetryModel}');
    expect(source).toContain('Project Memory');
    expect(source).toContain('Project Artifacts');
    expect(source).toContain('Highest reported stage spend');
    expect(source).toContain('Latest activation packet');
    expect(source).toContain('gate lanes');
    expect(source).toContain('InspectorMetric');
    expect(source).toContain('buildWorkflowInspectorTraceModel');
    expect(source).toContain('buildWorkflowInspectorFocusSummary');
    expect(source).toContain('InspectorFocusCard');
    expect(source).toContain('buildWorkflowInspectorTelemetryModel');
    expect(source).toContain('TraceCoverageNote');
    expect(source).toContain('workflowId');
    expect(source).toContain('LogsSurface');
    expect(source).toContain('scopedWorkflowId={workflowId}');
  });

  it('keeps continuous workflows on live stage sets instead of falling back to current_stage', () => {
    const source = readSource();
    expect(source).toContain('describeLiveStageLabel');
    expect(source).toContain("if (workflow?.lifecycle === 'continuous')");
    expect(source).toContain("return 'No live stages'");
    expect(source).not.toContain('workflow?.current_stage ||');
  });
});
