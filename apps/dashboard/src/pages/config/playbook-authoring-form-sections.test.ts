import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return [
    './playbook-authoring-form-sections.tsx',
    './playbook-authoring-structured-controls.tsx',
  ]
    .map((path) => readFileSync(resolve(import.meta.dirname, path), 'utf8'))
    .join('\n');
}

describe('playbook authoring form sections source', () => {
  it('rebuilds playbook authoring around process rules while keeping advanced overrides available', () => {
    const source = readSource();
    expect(source).toContain('validateBoardColumnsDraft');
    expect(source).toContain('TypedParameterValueControl');
    expect(source).toContain('Remove Role');
    expect(source).toContain('className="min-w-0 flex-1"');
    expect(source).toContain('className="shrink-0 whitespace-nowrap px-3"');
    expect(source).toContain('Process Instructions');
    expect(source).toContain('Review Rules');
    expect(source).toContain('Approval Rules');
    expect(source).toContain('Handoff Rules');
    expect(source).toContain('Workflow Checkpoints');
    expect(source).toContain('Launch Inputs');
    expect(source).toContain('This is operator-authored guidance for the orchestrator.');
    expect(source).toContain('Mandatory rules below are still');
    expect(source).toContain('Most playbooks should keep the standard board.');
    expect(source).toContain('Default intake column');
    expect(source).toContain('Automation and manual intake land here');
    expect(source).toContain('Blocked lane');
    expect(source).toContain('Terminal lane');
    expect(source).toContain('Playbooks use active role definitions from the shared role catalog.');
    expect(source).toContain('Human approval is required before the work item can complete.');
    expect(source).toContain('the next specialist always receives the right predecessor context');
    expect(source).toContain('project.repository_url');
    expect(source).toContain('project.settings.default_branch');
    expect(source).toContain('project.credentials.git_token');
    expect(source).toContain('Help text');
    expect(source).toContain('Project mapping');
    expect(source).toContain('Category');
    expect(source).toContain('Operator label');
    expect(source).toContain('Description');
    expect(source).toContain('Max rework iterations');
    expect(source).toContain('Max active tasks per work item');
    expect(source).toContain('Specialist runtime override');
    expect(source).toContain('Orchestration Policy');
    expect(source).not.toContain('Custom role');
    expect(source).not.toContain('Optional verification tools');
    expect(source).not.toContain('toggleOrchestratorTool');
    expect(source).not.toContain('Shared runtime defaults');
    expect(source).not.toContain('Orchestrator pool override');
    expect(source).not.toContain('Pull policy');
    expect(source).not.toContain('Input style');
    expect(source).not.toContain('PARAMETER_INPUT_STYLE_OPTIONS');
    expect(source).not.toContain('type="checkbox"');
  });
});
