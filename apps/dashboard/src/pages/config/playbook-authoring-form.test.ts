import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './playbook-authoring-form.tsx'), 'utf8');
}

describe('playbook authoring form source', () => {
  it('adds a guided structured overview ahead of the detailed authoring sections', () => {
    const source = readSource();
    expect(source).toContain('summarizePlaybookAuthoringDraft');
    expect(source).toContain('dashboardApi.listRoleDefinitions');
    expect(source).toContain('Authoring Overview');
    expect(source).toContain(
      'Review the current board shape, stage gates, launch inputs, and runtime posture',
    );
    expect(source).toContain('OverviewCard');
    expect(source).toContain('Parallel work items enabled');
    expect(source).toContain('Max active tasks');
  });

  it('uses tabs for progressive disclosure instead of one long linear stack', () => {
    const source = readSource();
    expect(source).toContain('data-testid="playbook-authoring-tabs"');
    expect(source).toContain('sticky top-4');
    expect(source).toContain('TabsList');
    expect(source).toContain('TabsTrigger');
    expect(source).toContain('sm:grid-cols-3');
    expect(source).toContain('Flow Design');
    expect(source).toContain('Automation Policy');
    expect(source).toContain('Launch and Runtime');
  });

  it('keeps the detailed structured authoring sections intact', () => {
    const source = readSource();
    expect(source).toContain('TeamRolesSection');
    expect(source).toContain('BoardColumnsSection');
    expect(source).toContain('WorkflowStagesSection');
    expect(source).toContain('OrchestratorSection');
    expect(source).toContain('RuntimeAndParametersSection');
    expect(source).not.toContain('availableToolOptions');
  });
});
