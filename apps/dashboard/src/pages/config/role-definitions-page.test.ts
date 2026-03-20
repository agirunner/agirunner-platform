import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './role-definitions-page.tsx'), 'utf8');
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
    expect(source).toContain('Create Role');
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
    expect(source).toContain('ToggleCard');
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

  it('reuses the shared image reference field across roles and orchestrator posture editing', () => {
    const source = readCombinedSource();
    expect(source).toContain('ImageReferenceField');
  });

  it('provides an inline active toggle so operators skip the full dialog for status changes', () => {
    const source = readCombinedSource();
    expect(source).toContain('onToggleActive');
    expect(source).toContain('toggleActiveMutation');
    expect(source).toContain('Updated role active state.');
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
    expect(source).toContain('No roles defined');
    expect(source).toContain('Create Role');
    const emptyStateMatch = source.match(/No roles defined[\s\S]*?Create Role/);
    expect(emptyStateMatch).not.toBeNull();
  });

  it('supports a first-class create role flow and uses the live create and replace routes', () => {
    const source = readCombinedSource();
    expect(source).toContain('Create Role');
    expect(source).toContain('dashboardApi.saveRoleDefinition');
    expect(source).not.toContain("method: 'PATCH'");
  });

  it('adds a first-class orchestrator control plane with direct prompt, model, and pool editing', () => {
    const source = readCombinedSource();
    expect(source).toContain('OrchestratorControlPlane');
    expect(source).toContain('Edit prompt');
    expect(source).toContain('Edit orchestrator prompt');
    expect(source).toContain('Save orchestrator prompt');
    expect(source).toContain('max-w-4xl');
    expect(source).toContain('min-h-[420px]');
    expect(source).toContain('Save model routing');
    expect(source).toContain('Save pool posture');
    expect(source).toContain('dashboardApi.getOrchestratorConfig()');
    expect(source).toContain('dashboardApi.updateOrchestratorConfig');
    expect(source).toContain("updateAssignment('orchestrator'");
  });

  it('exposes a first-class delete role flow for custom roles with built-in protection', () => {
    const source = readCombinedSource();
    expect(source).toContain('dashboardApi.deleteRoleDefinition');
    expect(source).toContain('DeleteRoleDialog');
    expect(source).toContain('Delete Role');
    expect(source).toContain('Built-in roles are protected and can only be deactivated.');
    expect(source).toContain('onDelete={setDeletingRole}');
  });

  it('keeps the expanded role row compact and human-readable', () => {
    const source = readExpandedRoleRowSource();
    expect(source).toContain('Verification and escalation');
    expect(source).toContain('line-clamp-3');
    expect(source).not.toContain('Capabilities');
    expect(source).not.toContain('Metadata');
    expect(source).not.toContain('props.role.allowed_tools.map');
  });
});
