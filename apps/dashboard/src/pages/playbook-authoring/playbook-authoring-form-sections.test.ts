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
    expect(source).toContain('Workflow Stages');
    expect(source).toContain('mandatory outcomes, preferred steps');
    expect(source).toContain('The orchestrator should use explicit handoffs');
    expect(source).toContain('process guide');
    expect(source).toContain('must still drive the workflow to closure');
    expect(source).toContain('Playbooks use active role definitions');
    expect(source).toContain('Default intake column');
    expect(source).toContain('Blocked lane');
    expect(source).toContain('Terminal lane');
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
