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
  it('rebuilds playbook authoring around process rules while keeping orchestrator controls available', () => {
    const source = readSource();
    expect(source).toContain('validateBoardColumnsDraft');
    expect(source).toContain('TypedParameterValueControl');
    expect(source).toContain('Remove Role');
    expect(source).toContain('className="min-w-0 flex-1"');
    expect(source).toContain('className="shrink-0 whitespace-nowrap px-3"');
    expect(source).toContain('Process Instructions');
    expect(source).toContain('Assessment Rules');
    expect(source).toContain('Approval Rules');
    expect(source).toContain('Branch Policies');
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
    expect(source).toContain('Playbooks use active role definitions from the shared workspace configuration.');
    expect(source).toContain('On changes requested');
    expect(source).toContain('On rejected');
    expect(source).toContain('On blocked');
    expect(source).toContain('Allow blocked decision');
    expect(source).toContain('Approval before assessment');
    expect(source).toContain('Assessment retention');
    expect(source).toContain('Approval retention');
    expect(source).toContain('Terminate branch');
    expect(source).toContain('the next specialist always receives the right predecessor context');
    expect(source).toContain('workspace.credentials.git_token');
    expect(source).toContain('Help text');
    expect(source).toContain('Workspace mapping');
    expect(source).toContain('Category');
    expect(source).toContain('Operator label');
    expect(source).toContain('Description');
    expect(source).toContain('Max rework iterations');
    expect(source).toContain('Task max iterations');
    expect(source).toContain('LLM retry attempts');
    expect(source).toContain('Max active tasks per work item');
    expect(source).toContain('Orchestration Policy');
    expect(source).not.toContain('Custom role');
    expect(source).not.toContain('Optional verification tools');
    expect(source).not.toContain('toggleOrchestratorTool');
    expect(source).not.toContain('Shared runtime defaults');
    expect(source).not.toContain('Specialist runtime override');
    expect(source).not.toContain('Orchestrator pool override');
    expect(source).not.toContain('Pull policy');
    expect(source).not.toContain('Input style');
    expect(source).not.toContain('PARAMETER_INPUT_STYLE_OPTIONS');
    expect(source).not.toContain('type="checkbox"');
  });

  it('renders assessment, approval, and handoff rules through a compact inline row shell', () => {
    const source = readSource();
    expect(source).toContain('function InlineRuleRow(');
    expect(source).toContain('function InlineRuleField(');
    expect(source).toContain('InlineRuleActions');
    expect(source).toContain('xl:flex xl:min-w-0 xl:flex-1 xl:items-center xl:gap-3');
    expect(source).toContain('xl:[&>*]:flex-1');
    expect(source).toContain('xl:shrink-0');
    expect(source).toContain('flex flex-col gap-3 xl:flex-row xl:items-center');
    expect(source).toContain('flex flex-col gap-1 lg:flex-row lg:items-center');
    expect(source).not.toContain('title={`Assessment rule ${index + 1}`}');
    expect(source).not.toContain('title={`Approval rule ${index + 1}`}');
    expect(source).not.toContain('title={`Handoff rule ${index + 1}`}');
  });
});
