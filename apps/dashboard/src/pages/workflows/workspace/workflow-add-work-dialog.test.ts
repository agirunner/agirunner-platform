import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('WorkflowAddWorkDialog source', () => {
  it('keeps modify mode focused on editable inputs, files, and steering only', () => {
    const source = readFileSync(new URL('./workflow-add-work-dialog.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('Owner role');
    expect(source).toContain('Steering instruction');
    expect(source).toContain('Editable inputs');
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

  it('clarifies how workflow-scope add or modify work attaches new operator inputs', () => {
    const source = readFileSync(new URL('./workflow-add-work-dialog.tsx', import.meta.url), 'utf8');

    expect(source).toContain('workflow-scoped input packet');
    expect(source).toContain('If you opened this from task scope');
    expect(source).toContain('parent work item');
  });

  it('creates new work with an embedded initial input packet instead of a second follow-up packet mutation', () => {
    const source = readFileSync(new URL('./workflow-add-work-dialog.tsx', import.meta.url), 'utf8');
    const newWorkBranch = source.slice(
      source.indexOf('const trimmedTitle = title.trim();'),
      source.indexOf('return workItem;'),
    );

    expect(newWorkBranch).toContain('initial_input_packet');
    expect(newWorkBranch).toContain('createWorkflowWorkItem(props.workflowId, payload)');
    expect(newWorkBranch).not.toContain('createWorkflowInputPacket(props.workflowId');
  });
});
