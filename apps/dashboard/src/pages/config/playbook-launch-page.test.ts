import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './playbook-launch-page.tsx'), 'utf8');
}

describe('playbook launch model override source', () => {
  it('describes playbook launch in v2 workflow terms', () => {
    const source = readSource();
    expect(source).toContain('Create a new workflow run from a playbook with structured run inputs, board-aware context,');
  });

  it('builds structured launch controls instead of raw JSON textareas', () => {
    const source = readSource();
    expect(source).toContain('Structured launch flow');
    expect(source).toContain('max-w-7xl');
    expect(source).toContain('sticky bottom-4');
    expect(source).toContain('Launch Readiness');
    expect(source).toContain('Playbook Snapshot');
    expect(source).toContain('LaunchReadinessPanel');
    expect(source).toContain('LaunchDefinitionSnapshot');
    expect(source).toContain('Playbook Parameters');
    expect(source).toContain('Metadata Entries');
    expect(source).toContain('Workflow Budget Policy');
    expect(source).toContain('WorkflowBudgetEditor');
    expect(source).toContain('Token Budget');
    expect(source).toContain('Cost Cap (USD)');
    expect(source).toContain('Max Duration (Minutes)');
    expect(source).toContain('Workflow Model Overrides');
    expect(source).toContain('RoleOverrideEditor');
    expect(source).toContain('SelectWithCustomControl');
    expect(source).toContain('Remove Entry');
    expect(source).toContain('Remove Override');
    expect(source).toContain('StructuredEntryEditor');
    expect(source).toContain('Reasoning Config Entries');
    expect(source).not.toContain('Reasoning Config JSON');
  });

  it('assembles the existing workflow create contract from structured launch state', () => {
    const source = readSource();
    expect(source).toContain('buildParametersFromDrafts');
    expect(source).toContain('readMappedProjectParameterDraft');
    expect(source).toContain("buildStructuredObject(metadataDrafts, 'Metadata')");
    expect(source).toContain('buildModelOverrides(modelOverrideDrafts)');
    expect(source).toContain('buildWorkflowBudgetInput(workflowBudgetDraft)');
    expect(source).toContain('readLaunchValidationError');
    expect(source).toContain('dashboardApi.createWorkflow({');
    expect(source).toContain('model_overrides: modelOverrides');
    expect(source).toContain('budget: workflowBudget.value');
    expect(source).toContain('Resolved Effective Models');
  });
});
