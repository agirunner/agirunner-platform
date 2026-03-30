import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('WorkflowLaunchDialog source', () => {
  it('requires the operator to choose a playbook instead of silently picking the first one', () => {
    const source = readFileSync(new URL('./workflow-launch-dialog.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('setSelectedPlaybookId(playbooks[0].id)');
    expect(source).toContain('placeholder="Select playbook"');
  });

  it('removes budget guardrail fields from the workflow launch modal', () => {
    const source = readFileSync(new URL('./workflow-launch-dialog.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('Token budget');
    expect(source).not.toContain('Cost cap (USD)');
    expect(source).not.toContain('Max duration (minutes)');
  });

  it('keeps operator-authored strings in compact textareas and flattens launch inputs', () => {
    const source = readFileSync(new URL('./workflow-launch-dialog.tsx', import.meta.url), 'utf8');

    expect(source.match(/rows=\{2\}/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(source.match(/min-h-\[64px\]/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(source).not.toContain('ChainParameterField');
    expect(source).not.toContain('<h3 className="text-sm font-medium">Launch inputs</h3>');
    expect(source).not.toContain('Provide the operator-authored inputs defined by the selected playbook.');
  });

  it('keeps launch inputs free of slug badge chrome so only the human title is shown', () => {
    const source = readFileSync(new URL('./workflow-launch-dialog.tsx', import.meta.url), 'utf8');

    expect(source).toContain('<span className="font-medium">{spec.title}</span>');
    expect(source).not.toContain('Badge');
    expect(source).not.toContain('spec.slug}</span>');
  });

  it('persists launch files through workflow creation instead of a second packet request', () => {
    const source = readFileSync(new URL('./workflow-launch-dialog.tsx', import.meta.url), 'utf8');

    expect(source).toContain('initial_input_packet');
    expect(source).not.toContain('createWorkflowInputPacket(workflow.id');
  });

  it('clears stale launch-form errors when the operator edits the draft after a failure', () => {
    const source = readFileSync(new URL('./workflow-launch-dialog.tsx', import.meta.url), 'utf8');

    expect(source).toContain('function clearLaunchFeedback()');
    expect(source).toContain('clearLaunchFeedback();');
    expect(source).toContain('setErrorMessage(null);');
  });

  it('surfaces the first blocking validation issue in the form feedback and uses support-driven launch input errors', () => {
    const source = readFileSync(new URL('./workflow-launch-dialog.tsx', import.meta.url), 'utf8');

    expect(source).toContain('validation.blockingIssues[0] ?? DEFAULT_FORM_VALIDATION_MESSAGE');
    expect(source).toContain('validation.parameterErrors[spec.slug]');
    expect(source).not.toContain("{`Enter a value for ${spec.title}.`}");
  });

  it('uses searchable comboboxes for playbook and workspace selection', () => {
    const source = readFileSync(new URL('./workflow-launch-dialog.tsx', import.meta.url), 'utf8');

    expect(source).toContain('SearchableCombobox');
    expect(source).not.toContain('placeholder="Type a playbook name or slug"');
    expect(source).not.toContain('placeholder="Type a workspace name or slug"');
    expect(source).toContain('items={playbookItems}');
    expect(source).toContain('items={workspaceItems}');
    expect(source).not.toContain('items={filteredPlaybookItems}');
    expect(source).not.toContain('items={filteredWorkspaceItems}');
    expect(source).toContain('searchPlaceholder="Search playbooks..."');
    expect(source).toContain('searchPlaceholder="Search workspaces..."');
    expect(source).not.toContain('<SelectTrigger');
    expect(source).not.toContain('<SelectContent');
  });

  it('auto-selects the sole remaining workspace through the shared launch helper instead of hardcoding a first-row default', () => {
    const source = readFileSync(new URL('./workflow-launch-dialog.tsx', import.meta.url), 'utf8');

    expect(source).toContain(
      "setWorkspaceId((current) => resolveDefaultWorkflowLaunchWorkspaceId(workspaces, current));",
    );
    expect(source).not.toContain('setWorkspaceId(workspaces[0].id)');
  });

  it('removes design-surface links and icon-heavy chrome from the launch form body', () => {
    const source = readFileSync(new URL('./workflow-launch-dialog.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('Edit selected playbook');
    expect(source).not.toContain('Edit selected workspace');
    expect(source).not.toContain('<Rocket');
    expect(source).not.toContain("from 'react-router-dom'");
  });
});
