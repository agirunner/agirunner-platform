import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './playbook-authoring-form.tsx'), 'utf8');
}

describe('playbook authoring form source', () => {
  it('keeps the primary authoring path process-first instead of summary-card-first', () => {
    const source = readSource();
    expect(source).toContain('dashboardApi.listRoleDefinitions');
    expect(source).toContain('Process-first authoring');
    expect(source).toContain(
      'Define the workflow outcome, structure the stages, and tell the orchestrator how',
    );
    expect(source).toContain('Mandatory outcomes, preferred reviews, fallback paths, and closure expectations');
    expect(source).toContain('best-intent execution guide');
    expect(source).toContain('instead of separate governance config');
    expect(source).toContain('Process');
    expect(source).toContain('Inputs');
    expect(source).toContain('Advanced');
    expect(source).not.toContain('Authoring Overview');
    expect(source).not.toContain('OverviewCard');
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

  it('rebuilds the detailed sections around process guidance, stages, inputs, and advanced overrides', () => {
    const source = readSource();
    expect(source).toContain('ProcessInstructionsSection');
    expect(source).toContain('TeamRolesSection');
    expect(source).toContain('WorkflowStagesSection');
    expect(source).toContain('LaunchInputsSection');
    expect(source).toContain('AdvancedWorkflowSection');
    expect(source).not.toContain('availableToolOptions');
  });
});
