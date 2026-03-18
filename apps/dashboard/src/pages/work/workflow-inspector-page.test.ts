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
    expect(source).toContain('dashboardApi.getWorkspace');
    expect(source).toContain('dashboardApi.getLogStats');
    expect(source).toContain('dashboardApi.getLatestWorkflowWorkItemHandoff');
    expect(source).toContain('dashboardApi.getWorkflowWorkItemMemoryHistory');
    expect(source).toContain('Workflow Board Inspector');
    expect(source).toContain('Workflow Board');
    expect(source).toContain('Current operator scope');
    expect(source).toContain('InspectorSectionJumpStrip');
    expect(source).toContain('Board posture');
    expect(source).toContain('Current board stage in the scoped workflow shell');
    expect(source).toContain('Operator focus');
    expect(source).toContain('Best next step:');
    expect(source).toContain('Trace coverage');
    expect(source).toContain('Scoped log trace');
    expect(source).toContain('Workflow telemetry');
    expect(source).toContain('Trace drill-in posture');
    expect(source).toContain('WorkflowInspectorTelemetryPanel');
    expect(source).toContain('telemetry={telemetryModel}');
    expect(source).toContain('Workspace Memory');
    expect(source).toContain('Workspace Artifacts');
    expect(source).toContain('Highest reported stage spend');
    expect(source).toContain('Latest activation packet');
    expect(source).toContain('gate lanes');
    expect(source).toContain('InspectorMetric');
    expect(source).toContain('InspectorLinkCard');
    expect(source).toContain('buildWorkflowInspectorTraceModel');
    expect(source).toContain('buildWorkflowInspectorFocusSummary');
    expect(source).toContain('InspectorFocusCard');
    expect(source).toContain('buildWorkflowInspectorTelemetryModel');
    expect(source).toContain('TraceCoverageNote');
    expect(source).toContain('workflowId');
    expect(source).toContain('LogsSurface');
    expect(source).toContain('scopedWorkflowId={workflowId}');
    expect(source).toContain('mode="inspector"');
  });

  it('uses lifecycle-aware stage presentation for standard and continuous workflows', () => {
    const source = readSource();
    expect(source).toContain('describeWorkflowStageLabel');
    expect(source).toContain('describeWorkflowStageValue');
    expect(source).toContain('describeWorkflowScopeSummary');
    expect(source).toContain('label={stageLabel}');
    expect(source).toContain('value={stageValue}');
    expect(source).toContain('scopeSummary');
  });
});
