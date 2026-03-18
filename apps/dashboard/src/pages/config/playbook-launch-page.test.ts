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
      'Start a workflow from a playbook with structured launch inputs, workspace autofill, and',
    );
  });

  it('builds structured launch controls instead of raw JSON textareas', () => {
    const source = readSource();
    expect(source).toContain('data-testid="playbook-launch-surface"');
    expect(source).toContain('mx-auto max-w-[88rem] space-y-6 px-4 py-6 sm:px-6');
    expect(source).toContain('Process-First Launch');
    expect(source).toContain(
      'Start with the playbook process, add workspace context when it can autofill inputs,',
    );
    expect(source).toContain(
      'then open advanced launch policy only when this run needs extra control.',
    );
    expect(source).toContain('Workflow Basics');
    expect(source).toContain('Process Snapshot');
    expect(source).toContain('LaunchReadinessPanel');
    expect(source).toContain('LaunchDefinitionSnapshot');
    expect(source).toContain('Resolution order');
    expect(source).toContain('Playbook default');
    expect(source).toContain('Workspace autofill');
    expect(source).toContain('Launch override');
    expect(source).toContain('launchablePlaybooks');
    expect(source).toContain('Inactive playbook selected - save reactivation first');
    expect(source).toContain(
      'This playbook is inactive. Save a reactivated version from the playbook detail page',
    );
    expect(source).toContain('Launch Inputs');
    expect(source).toContain('Using playbook default');
    expect(source).toContain('Using workspace autofill');
    expect(source).toContain('Launch override active');
    expect(source).toContain('Launch override clears inherited value');
    expect(source).toContain('Use workspace autofill');
    expect(source).toContain('Restore playbook default');
    expect(source).toContain('Metadata Entries');
    expect(source).toContain('Advanced launch policy');
    expect(source).toContain('Open only when this run needs metadata, workflow policy, budget');
    expect(source).toContain('Workflow Config Overrides');
    expect(source).toContain('Additional Config Override Paths');
    expect(source).toContain('Clear override');
    expect(source).toContain('tools.web_search_provider');
    expect(source).toContain('Instruction Layer Policy');
    expect(source).toContain('Platform instructions');
    expect(source).toContain('Workspace instructions');
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
    expect(source).toContain('Launch action');
    expect(source).toContain('Ready to launch');
    expect(source).toContain('Resolve blockers');
    expect(source).toContain('validateLaunchDraft');
    expect(source).toContain('additionalParametersError');
    expect(source).toContain('metadataError');
    expect(source).toContain('launchValidation.fieldErrors.workflowName');
    expect(source).toContain('All required launch inputs are present.');
    expect(source).toContain('Launch Workflow');
    expect(source).not.toContain('Workflow launch status');
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
    expect(source).toContain('readMappedWorkspaceParameterDraft');
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
