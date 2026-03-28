import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('WorkflowAddWorkDialog source', () => {
  it('keeps add and modify work focused on operator inputs, files, and steering only', () => {
    const source = readFileSync(new URL('./workflow-add-work-dialog.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('Owner role');
    expect(source).toContain('Steering instruction');
    expect(source).not.toContain('Input type');
    expect(source).toContain('Work item inputs');
    expect(source).not.toContain("<span className=\"font-medium\">Goal</span>");
  });

  it('removes internal workflow-planning fields from the operator add-work modal', () => {
    const source = readFileSync(new URL('./workflow-add-work-dialog.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('Acceptance criteria');
    expect(source).not.toContain('Auto-route');
    expect(source).not.toContain('Priority');
    expect(source).not.toContain('Operator note');
    expect(source).toContain('Work item title');
  });

  it('removes the old workflow attachment explainer chrome from the operator modal', () => {
    const source = readFileSync(new URL('./workflow-add-work-dialog.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('How this attaches');
    expect(source).not.toContain('workflow-scoped input packet');
    expect(source).not.toContain('If you opened this from task scope');
    expect(source).toContain('parent work item');
  });

  it('creates new work with the embedded input packet and can add a steering request in the same flow', () => {
    const source = readFileSync(new URL('./workflow-add-work-dialog.tsx', import.meta.url), 'utf8');
    const newWorkBranch = source.slice(
      source.indexOf('const trimmedTitle = title.trim();'),
      source.indexOf('return workItem;'),
    );

    expect(newWorkBranch).toContain('initial_input_packet');
    expect(newWorkBranch).toContain('createWorkflowWorkItem(props.workflowId, payload)');
    expect(newWorkBranch).toContain('createWorkflowSteeringRequest(props.workflowId');
    expect(newWorkBranch).not.toContain('createWorkflowInputPacket(props.workflowId');
  });

  it('replaces the shared structured editor with a modal-local operator input editor', () => {
    const source = readFileSync(new URL('./workflow-add-work-dialog.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('ChainStructuredEntryEditor');
    expect(source).toContain('Add input');
    expect(source).toContain('Input name');
    expect(source).toContain('Input value');
    expect(source).not.toContain('<SelectItem value="number">');
    expect(source).not.toContain('<SelectItem value="boolean">');
    expect(source).not.toContain('<SelectItem value="json">');
  });
});
