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
  it('centers the authoring flow on process instructions, stages, roles, inputs, and orchestration policy', () => {
    const source = readSource();
    expect(source).toContain('Process Instructions');
    expect(source).toContain('Specialists');
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
    expect(source).not.toContain('Playbooks use active role definitions from the shared workspace configuration.');
    expect(source).toContain('Default intake column');
    expect(source).toContain('Blocked lane');
    expect(source).toContain('Terminal lane');
    expect(source).toContain('lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.35fr)] lg:items-stretch');
    expect(source).toContain('lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start');
    expect(source).not.toContain('lg:grid-cols-[auto_minmax(0,1fr)] lg:items-start');
    expect(source).not.toContain('lg:grid-cols-[6rem_minmax(0,1fr)]');
    expect(source).toContain('Launch Inputs');
    expect(source).toContain('Workspace mapping');
    expect(source).toContain('Category');
    expect(source).toContain('Operator label');
    expect(source).toContain('Max rework iterations');
    expect(source).toContain('System default: 5');
    expect(source).toContain('Task max iterations');
    expect(source).toContain('LLM retry attempts');
    expect(source).toContain('System default: 4');
    expect(source).toContain('System default: 2');
    expect(source).toContain('Max active tasks per work item');
    expect(source).toContain('System default: enabled');
    expect(source).toContain('Orchestration Policy');
    expect(source).not.toContain('Assessment Rules');
    expect(source).not.toContain('Approval Rules');
    expect(source).not.toContain('Branch Policies');
    expect(source).not.toContain('Handoff Rules');
    expect(source).not.toContain('Workflow Checkpoints');
    expect(source).not.toContain('Mandatory rules below are still');
    expect(source).not.toContain('terminate_branch');
  });
});
