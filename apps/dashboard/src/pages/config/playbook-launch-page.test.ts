import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return [
    './playbook-launch-page.tsx',
    './playbook-launch-page.effects.ts',
    './playbook-launch-page.mutation.ts',
    './playbook-launch-budget.tsx',
    './playbook-launch-page.sections.tsx',
    './playbook-launch-form.tsx',
    './playbook-launch-parameters.tsx',
    './playbook-launch-support.ts',
    './playbook-launch-readiness.tsx',
    './playbook-launch-entries.tsx',
    './playbook-launch-overrides.tsx',
    './playbook-launch-workflow-policy.tsx',
    './playbook-launch-workflow-policy.support.ts',
    './playbook-launch-summary.tsx',
    './playbook-launch-identity.tsx',
  ]
    .map((path) => readFileSync(resolve(import.meta.dirname, path), 'utf8'))
    .join('\n');
}

describe('playbook launch model override source', () => {
  it('describes playbook launch in v2 workflow terms', () => {
    const source = readSource();
    expect(source).toContain(
      'Start a workflow from a playbook with structured launch inputs, project autofill, and',
    );
  });

  it('builds structured launch controls instead of raw JSON textareas', () => {
    const source = readSource();
    expect(source).toContain('data-testid="playbook-launch-surface" className="space-y-6 p-4 sm:p-6"');
    expect(source).toContain('Workflow Launch');
    expect(source).toContain('Workflow Basics');
    expect(source).toContain('Workflow Structure');
    expect(source).toContain('LaunchReadinessPanel');
    expect(source).toContain('LaunchDefinitionSnapshot');
    expect(source).toContain('launchablePlaybooks');
    expect(source).toContain('Archived revision selected - restore first');
    expect(source).toContain(
      'This playbook revision is archived. Restore it from the playbook detail page',
    );
    expect(source).toContain('Playbook Parameters');
    expect(source).toContain('Project autofill available');
    expect(source).toContain('Using project value');
    expect(source).toContain('Custom launch override');
    expect(source).toContain('Use project value');
    expect(source).toContain('Metadata Entries');
    expect(source).toContain('Workflow Config Overrides');
    expect(source).toContain('Additional Config Override Paths');
    expect(source).toContain('Clear override');
    expect(source).toContain('tools.web_search_provider');
    expect(source).toContain('Instruction Layer Policy');
    expect(source).toContain('Platform instructions');
    expect(source).toContain('Project instructions');
    expect(source).toContain('Restore playbook defaults');
    expect(source).toContain('ToggleCard');
    expect(source).toContain('Workflow Budget Policy');
    expect(source).toContain('WorkflowBudgetEditor');
    expect(source).toContain('Open-ended workflow');
    expect(source).toContain('Guarded workflow');
    expect(source).toContain(
      'No workflow budget guardrails. The workflow will launch with open-ended defaults',
    );
    expect(source).toContain('Guardrail inputs');
    expect(source).toContain('Clear guardrails');
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
    expect(source).toContain('Description is operator-facing catalog copy only.');
    expect(source).toContain('Launch Workflow');
    expect(source).not.toContain('Reasoning Config JSON');
    expect(source).not.toContain('Launch overview');
    expect(source).not.toContain('Jump to section');
    expect(source).not.toContain('sticky bottom-4');
    expect(source).not.toContain('Launch Run');
    expect(source).not.toContain('Run Configuration');
    expect(source).not.toContain('Run Identity');
  });

  it('assembles the existing workflow create contract from structured launch state', () => {
    const source = readSource();
    expect(source).toContain('buildParametersFromDrafts');
    expect(source).toContain('readMappedProjectParameterDraft');
    expect(source).toContain("buildStructuredObject(input.metadataDrafts, 'Metadata')");
    expect(source).toContain('buildWorkflowConfigOverrides({');
    expect(source).toContain('buildInstructionConfig({');
    expect(source).toContain('buildModelOverrides(input.modelOverrideDrafts)');
    expect(source).toContain('buildWorkflowBudgetInput(workflowBudgetDraft)');
    expect(source).toContain('props.validation.blockingIssues');
    expect(source).toContain('dashboardApi.createWorkflow({');
    expect(source).toContain('config_overrides: buildWorkflowConfigOverrides({');
    expect(source).toContain('instruction_config: buildInstructionConfig({');
    expect(source).toContain('model_overrides: buildModelOverrides(input.modelOverrideDrafts)');
    expect(source).toContain('budget: input.workflowBudget');
    expect(source).toContain('Resolved Effective Models');
    expect(source).toContain('scroll-mt-24');
  });
});
