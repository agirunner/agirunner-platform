import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return [
    './playbook-authoring-form-sections.tsx',
    './playbook-authoring-form-sections.core.tsx',
    './playbook-authoring-form-sections.advanced.tsx',
    './playbook-authoring-form-sections.shared.tsx',
    './playbook-authoring-structured-controls.tsx',
    './playbook-authoring-structured-choice-controls.tsx',
    './playbook-authoring-structured-parameter-editor.tsx',
  ]
    .map((path) => readFileSync(resolve(import.meta.dirname, path), 'utf8'))
    .join('\n');
}

describe('playbook authoring form sections source', () => {
  it('centers the authoring flow on process instructions, specialists, launch inputs, stages, and orchestration policy', () => {
    const source = readSource();
    expect(source).toContain('Process Instructions');
    expect(source).toContain('Specialists');
    expect(source).toContain('Launch Inputs');
    expect(source).toContain('Workflow Stages');
    expect(source).toContain('mandatory outcomes, preferred steps');
    expect(source).toContain('This guidance is the workflow contract:');
    expect(source).toContain('max-w-full overflow-x-auto whitespace-nowrap text-sm text-muted');
    expect(source).toContain('acceptable fallback paths, true blockers');
    expect(source).toContain('Choose the active specialist definitions for this workflow.');
    expect(source).toContain('Add specialist');
    expect(source).toContain('Select a specialist');
    expect(source).toContain('Remove Specialist');
    expect(source).not.toContain('The orchestrator should use explicit handoffs');
    expect(source).not.toContain('Write this as a process guide:');
    expect(source).not.toContain('Team Roles');
    expect(source).not.toContain('Add Role');
    expect(source).not.toContain('Remove Role');
    expect(source).not.toContain('Select a role definition');
    expect(source).not.toContain(
      'Playbooks use active role definitions from the shared workspace configuration.',
    );
    expect(source).toContain(
      'Each launch input declares one workflow goal that operators can provide when the workflow starts.',
    );
    expect(source).toContain('Slug');
    expect(source).toContain('Title');
    expect(source).toContain('Required');
    expect(source).not.toContain('<span className="font-medium">Required</span>');
    expect(source).not.toContain('<span className="font-medium">Actions</span>');
    expect(source).toContain('Add Input');
    expect(source).not.toContain('Workspace mapping');
    expect(source).not.toContain('Category');
    expect(source).not.toContain('Operator label');
    expect(source).not.toContain('Allowed values');
    expect(source).not.toContain('Default value');
    expect(source).not.toContain('Secret');
    expect(source).toContain('Intake lane');
    expect(source).toContain('md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end');
    expect(source).toContain('Blocked lane');
    expect(source).toContain('Terminal lane');
    expect(source).toContain('Choose the intake lane');
    expect(source).toContain('Choose the blocked lane');
    expect(source).toContain('Choose the terminal lane');
    expect(source).not.toContain('checked={column.is_blocked}');
    expect(source).not.toContain('checked={column.is_terminal}');
    expect(source).toContain('lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.35fr)] lg:items-stretch');
    expect(source).toContain('lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start');
    expect(source).not.toContain('lg:grid-cols-[auto_minmax(0,1fr)] lg:items-start');
    expect(source).not.toContain('lg:grid-cols-[6rem_minmax(0,1fr)]');
    expect(source).toContain('Max rework iterations');
    expect(source).toContain('placeholder="10"');
    expect(source).toContain('Task max iterations');
    expect(source).toContain('LLM retry attempts');
    expect(source).toContain('placeholder="800"');
    expect(source).toContain('placeholder="5"');
    expect(source).toContain('Max active tasks per work item');
    expect(source).toContain('placeholder="No cap"');
    expect(source).toContain('<SelectValue placeholder="Default (Enabled)" />');
    expect(source).toContain(
      '<SelectItem value={ORCHESTRATION_POLICY_UNSET}>Default (Enabled)</SelectItem>',
    );
    expect(source).toContain('<SelectItem value="true">Enabled</SelectItem>');
    expect(source).toContain('<SelectItem value="false">Disabled</SelectItem>');
    expect(source).toContain('Leave fields blank to inherit the defaults: rework iterations `10`');
    expect(source).toContain('Orchestration Policy');
    expect(source).not.toContain('System default:');
    expect(source).not.toContain('Assessment Rules');
    expect(source).not.toContain('Approval Rules');
    expect(source).not.toContain('Branch Policies');
    expect(source).not.toContain('Handoff Rules');
    expect(source).not.toContain('Workflow Checkpoints');
    expect(source).not.toContain('Mandatory rules below are still');
    expect(source).not.toContain('terminate_branch');
  });
});
