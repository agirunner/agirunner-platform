import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return [
    './role-definitions-page.tsx',
    '../../components/list-pagination.tsx',
  ]
    .map((path) => readFileSync(resolve(import.meta.dirname, path), 'utf8'))
    .join('\n');
}

function readCombinedSource() {
  return [
    readSource(),
    readFileSync(resolve(import.meta.dirname, './role-definitions-page.api.ts'), 'utf8'),
    readFileSync(resolve(import.meta.dirname, './role-definitions-page.orchestrator.ts'), 'utf8'),
    readFileSync(resolve(import.meta.dirname, './role-definitions-dialog.tsx'), 'utf8'),
    readFileSync(resolve(import.meta.dirname, './role-definitions-dialog.basics.tsx'), 'utf8'),
    readFileSync(resolve(import.meta.dirname, './role-definitions-dialog.catalog.tsx'), 'utf8'),
    readFileSync(resolve(import.meta.dirname, './role-definitions-dialog.summary.tsx'), 'utf8'),
    readFileSync(resolve(import.meta.dirname, './role-definitions-dialog.support.ts'), 'utf8'),
    readFileSync(resolve(import.meta.dirname, './role-definitions-delete-dialog.tsx'), 'utf8'),
    readFileSync(resolve(import.meta.dirname, './role-definitions-lifecycle.ts'), 'utf8'),
    readFileSync(resolve(import.meta.dirname, './role-definitions-orchestrator.tsx'), 'utf8'),
    readFileSync(resolve(import.meta.dirname, './role-definitions-orchestrator.sections.tsx'), 'utf8'),
    readFileSync(resolve(import.meta.dirname, './role-definitions-orchestrator.dialogs.tsx'), 'utf8'),
    readFileSync(resolve(import.meta.dirname, './role-definitions-orchestrator.dialog-shared.tsx'), 'utf8'),
    readFileSync(resolve(import.meta.dirname, './role-definitions-orchestrator.pool-dialog.tsx'), 'utf8'),
    readFileSync(resolve(import.meta.dirname, './role-definitions-orchestrator.form.ts'), 'utf8'),
    readFileSync(resolve(import.meta.dirname, './role-definitions-orchestrator.support.ts'), 'utf8'),
    readFileSync(resolve(import.meta.dirname, './role-definitions-list.tsx'), 'utf8'),
    readFileSync(resolve(import.meta.dirname, './role-definitions-list.support.ts'), 'utf8'),
    readFileSync(resolve(import.meta.dirname, './role-definitions-page.support.ts'), 'utf8'),
  ].join('\n');
}

function readExpandedRoleRowSource() {
  return [
    readFileSync(resolve(import.meta.dirname, './role-definitions-list.tsx'), 'utf8'),
    readFileSync(resolve(import.meta.dirname, './role-definitions-list.support.ts'), 'utf8'),
  ].join('\n');
}

describe('role definitions page source', () => {
  it('exposes a first-class create role flow instead of edit-only administration', () => {
    const source = readCombinedSource();
    expect(source).toContain('Create Specialist');
    expect(source).toContain('saveRole');
    expect(source).toContain('dashboardApi.saveRoleDefinition');
  });

  it('keeps the role editor dialog scrollable and wide enough for large forms', () => {
    const source = readSource();
    expect(source).toContain("import { RoleDialog } from './role-definitions-dialog.js'");
    const dialogSource = readFileSync(resolve(import.meta.dirname, './role-definitions-dialog.tsx'), 'utf8');
    expect(dialogSource).toContain('top-[5vh] flex max-h-[90vh] max-w-[68rem] translate-y-0 flex-col overflow-hidden p-0');
    expect(dialogSource).toContain('RoleDialogFooter');
    expect(dialogSource).toContain('overflow-y-auto px-6 py-5');
  });

  it('keeps unknown existing allowed tools editable alongside the standard catalog', () => {
    const source = readCombinedSource();
    expect(source).toContain('listAvailableTools');
    expect(source).toContain('dashboardApi.listToolTags()');
    expect(source).toContain('Specialist agent tools');
    expect(source).toContain('Specialist execution tools');
    expect(source).toContain('Orchestrator-only tools are managed on the orchestrator surface');
    expect(source).toContain('ToggleCard');
    expect(source).not.toContain('KNOWN_TOOLS =');
    expect(source).not.toContain('type="checkbox"');
  });

  it('exposes structured model and active-state controls in the dialog', () => {
    const source = readCombinedSource();
    expect(source).toContain('Model assignment');
    expect(source).toContain('Active role');
    expect(source).toContain('Save readiness');
    expect(source).toContain('Resolve these role setup issues before saving.');
    expect(source).toContain('Choose a unique role name.');
  });

  it('uses the shared image reference field for orchestrator runtime editing while roles select a named execution environment', () => {
    const source = readCombinedSource();
    expect(source).toContain('ImageReferenceField');
    expect(source).toContain('Execution environment');
    expect(source).toContain('Select the specialist execution environment for this role.');
    expect(source).not.toContain('Specialist Execution container override');
    expect(source).toContain('placeholder="2"');
    expect(source).toContain('placeholder="256m"');
  });

  it('provides an inline active toggle so operators skip the full dialog for status changes', () => {
    const source = readCombinedSource();
    expect(source).toContain('onToggleActive');
    expect(source).toContain('toggleActiveMutation');
    expect(source).toContain('Updated specialist active state.');
    expect(source).toContain("aria-label={`Toggle ${props.role.name} active`}");
  });

  it('provides a duplicate action so operators can clone roles without rebuilding from scratch', () => {
    const source = readCombinedSource();
    expect(source).toContain('onDuplicate');
    expect(source).toContain('duplicateFrom');
    expect(source).toContain('Duplicate');
    expect(source).toContain("aria-label={`Duplicate ${props.role.name}`}");
  });

  it('shows a primary CTA button in the empty state per UX guideline 44', () => {
    const source = readSource();
    expect(source).toContain('No specialists defined');
    expect(source).toContain('Create Specialist');
    const emptyStateMatch = source.match(/No specialists defined[\s\S]*?Create Specialist/);
    expect(emptyStateMatch).not.toBeNull();
  });

  it('supports a first-class create role flow and uses the live create and replace routes', () => {
    const source = readCombinedSource();
    expect(source).toContain('Create Specialist');
    expect(source).toContain('dashboardApi.saveRoleDefinition');
    expect(source).not.toContain("method: 'PATCH'");
  });

  it('adds a first-class orchestrator control plane with direct prompt, model, and pool editing', () => {
    const source = readCombinedSource();
    const dialogsSource = readFileSync(resolve(import.meta.dirname, './role-definitions-orchestrator.dialogs.tsx'), 'utf8');
    expect(source).toContain('OrchestratorControlPlane');
    expect(source).toContain('Edit prompt');
    expect(source).toContain('Edit orchestrator prompt');
    expect(source).toContain('Save orchestrator prompt');
    expect(source).toContain('max-h-[92vh] max-w-[84rem] overflow-y-auto');
    expect(source).toContain('min-h-[640px] sm:min-h-[720px]');
    expect(source).toContain('Save model routing');
    expect(source).toContain('Save pool posture');
    expect(source).toContain('primaryLabel="Edit model"');
    expect(source).toContain('primaryLabel="Edit pool"');
    expect(source).toContain('detailClassName="line-clamp-3"');
    expect(source).toContain('Agent configuration');
    expect(source).toContain('Configure the runtime environment for the orchestrator');
    expect(source).not.toContain('Edit model here');
    expect(source).not.toContain('Edit pool here');
    expect(source).toContain('Agent image');
    expect(source).toContain('CPU / memory');
    expect(source).not.toContain('Worker desired state');
    expect(source).not.toContain('Configure the main orchestrator worker entry');
    expect(source).not.toContain('Existing worker names stay fixed. Create a new orchestrator entry here if you need a different name.');
    expect(source).not.toContain("label: 'Model pin'");
    expect(source).not.toContain('Worker model pin');
    expect(source).not.toContain('Keep the orchestrator worker defined but temporarily inactive when needed.');
    expect(source).not.toContain('<p className="text-sm font-medium">Enabled</p>');
    expect(source).toContain('text-base font-semibold leading-6 text-foreground');
    expect(source).not.toContain('text-lg font-semibold leading-6 text-foreground');
    expect(source).toContain('grid gap-2 border-t border-border/70 pt-3');
    expect(source).not.toContain('grid gap-2 rounded-lg border border-border/70 bg-background/80 p-3');
    expect(source).toContain('text-base font-semibold text-foreground');
    expect(source).toContain("{fact.label}:");
    expect(source).toContain('className="font-medium text-foreground"');
    expect(source).toContain('dashboardApi.getOrchestratorConfig()');
    expect(source).toContain('dashboardApi.updateOrchestratorConfig');
    expect(source).toContain("updateAssignment('orchestrator'");
    expect(dialogsSource).toContain('Orchestrator prompt is critical to the correct operation of the system. Only change');
    expect(dialogsSource).toContain('this if you know what you are doing.');
    expect(dialogsSource).toContain('<Textarea');
    expect(dialogsSource).not.toContain('<CardTitle className="text-base">Orchestrator prompt</CardTitle>');
    expect(dialogsSource).not.toContain('<CardContent className="space-y-3">');
    expect(dialogsSource).not.toContain('Org-wide platform instructions are applied separately.');
  });

  it('pins orchestrator control actions to a consistent card footer', () => {
    const source = readCombinedSource();
    expect(source).toContain('flex h-full flex-col gap-3');
    expect(source).toContain('flex-1 space-y-3');
    expect(source).toContain('mt-auto flex flex-wrap gap-2 pt-1');
  });

  it('exposes a first-class delete role flow for role definitions', () => {
    const source = readCombinedSource();
    expect(source).toContain('dashboardApi.deleteRoleDefinition');
    expect(source).toContain('DeleteRoleDialog');
    expect(source).toContain('Delete Specialist');
    expect(source).toContain('deleteErrorMessage={formatRoleDeleteError(deleteMutation.error)}');
    expect(source).toContain('deleteMutation.reset()');
    expect(source).toContain('Update any playbooks that still reference it before deletion.');
    expect(source).toContain('onDelete={setDeletingRole}');
  });

  it('renames the primary surface to Specialists while keeping role-definition internals intact', () => {
    const source = readSource();
    expect(source).toContain('DashboardPageHeader');
    expect(source).toContain('navHref="/design/specialists"');
    expect(source).toContain('Total specialists');
    expect(source).toContain('Active specialists');
    expect(source).toContain('Inactive specialists');
    expect(source).toContain('Specialist definitions');
    expect(source).toContain('Page size');
    expect(source).toContain('Showing');
    expect(source).toContain('Previous');
    expect(source).toContain('Next');
    expect(source).not.toContain('Roles</h1>');
  });

  it('keeps the expanded role row compact and human-readable', () => {
    const source = readExpandedRoleRowSource();
    expect(source).toContain('line-clamp-3');
    expect(source).not.toContain('Verification and escalation');
    expect(source).not.toContain('Capabilities');
    expect(source).not.toContain('Metadata');
    expect(source).not.toContain('detailSummary.governance');
    expect(source).not.toContain('props.role.allowed_tools.map');
  });
});
