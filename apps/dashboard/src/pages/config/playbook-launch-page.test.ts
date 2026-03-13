import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return [
    './playbook-launch-page.tsx',
    './playbook-launch-page.sections.tsx',
    './playbook-launch-parameters.tsx',
    './playbook-launch-support.ts',
  ]
    .map((path) => readFileSync(resolve(import.meta.dirname, path), 'utf8'))
    .join('\n');
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
    expect(source).toContain('Launch overview');
    expect(source).toContain('Jump to section');
    expect(source).toContain('LaunchReadinessPanel');
    expect(source).toContain('LaunchDefinitionSnapshot');
    expect(source).toContain('LaunchOverviewCards');
    expect(source).toContain('LaunchOutlineCard');
    expect(source).toContain('launchablePlaybooks');
    expect(source).toContain('Archived revision selected - restore first');
    expect(source).toContain('This playbook revision is archived. Restore it from the playbook detail page');
    expect(source).toContain('Playbook Parameters');
    expect(source).toContain('Project autofill available');
    expect(source).toContain('Using project value');
    expect(source).toContain('Custom launch override');
    expect(source).toContain('Use project value');
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
    expect(source).toContain('validateStructuredEntries');
    expect(source).toContain('validateRoleOverrideDrafts');
    expect(source).toContain('Resolve the highlighted entry rows before launch.');
    expect(source).toContain('Reasoning Config Entries');
    expect(source).toContain('validateLaunchDraft');
    expect(source).toContain('additionalParametersError');
    expect(source).toContain('metadataError');
    expect(source).toContain('launchValidation.fieldErrors.workflowName');
    expect(source).toContain('All required launch inputs are present.');
    expect(source).not.toContain('Reasoning Config JSON');
  });

  it('assembles the existing workflow create contract from structured launch state', () => {
    const source = readSource();
    expect(source).toContain('buildParametersFromDrafts');
    expect(source).toContain('readMappedProjectParameterDraft');
    expect(source).toContain("buildStructuredObject(metadataDrafts, 'Metadata')");
    expect(source).toContain('buildModelOverrides(modelOverrideDrafts)');
    expect(source).toContain('buildWorkflowBudgetInput(workflowBudgetDraft)');
    expect(source).toContain('props.validation.blockingIssues');
    expect(source).toContain('dashboardApi.createWorkflow({');
    expect(source).toContain('model_overrides: modelOverrides');
    expect(source).toContain('budget: workflowBudget');
    expect(source).toContain('Resolved Effective Models');
    expect(source).toContain('scroll-mt-24');
  });
});
