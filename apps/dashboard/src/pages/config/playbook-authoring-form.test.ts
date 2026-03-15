import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './playbook-authoring-form.tsx'), 'utf8');
}

describe('playbook authoring form source', () => {
  it('adds a process-first overview ahead of the detailed authoring sections', () => {
    const source = readSource();
    expect(source).toContain('summarizePlaybookAuthoringDraft');
    expect(source).toContain('dashboardApi.listRoleDefinitions');
    expect(source).toContain('Authoring Overview');
    expect(source).toContain(
      'Start with the process the orchestrator must follow',
    );
    expect(source).toContain('OverviewCard');
    expect(source).toContain('Process');
    expect(source).toContain('Rules');
    expect(source).toContain('Inputs');
    expect(source).toContain('Advanced');
  });

  it('uses tabs for progressive disclosure with process first and advanced controls separated', () => {
    const source = readSource();
    expect(source).toContain('data-testid="playbook-authoring-tabs"');
    expect(source).toContain('sticky top-4');
    expect(source).toContain('TabsList');
    expect(source).toContain('TabsTrigger');
    expect(source).toContain('sm:grid-cols-3');
    expect(source).toContain('Process');
    expect(source).toContain('Inputs');
    expect(source).toContain('Advanced');
  });

  it('rebuilds the detailed sections around process guidance, rules, inputs, and advanced overrides', () => {
    const source = readSource();
    expect(source).toContain('ProcessInstructionsSection');
    expect(source).toContain('TeamRolesSection');
    expect(source).toContain('WorkflowRulesSection');
    expect(source).toContain('LaunchInputsSection');
    expect(source).toContain('AdvancedWorkflowSection');
    expect(source).not.toContain('availableToolOptions');
  });
});
