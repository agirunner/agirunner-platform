import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './playbook-detail-page.tsx'), 'utf8');
}

describe('playbook detail page source', () => {
  it('builds a first-class structured playbook edit flow', () => {
    const source = readSource();
    expect(source).toContain('dashboardApi.getPlaybook');
    expect(source).toContain('dashboardApi.listPlaybooks');
    expect(source).toContain('dashboardApi.updatePlaybook');
    expect(source).toContain('space-y-6 p-4 sm:p-6');
    expect(source).toContain('PlaybookAuthoringForm');
    expect(source).toContain('PlaybookRevisionHistoryCard');
    expect(source).toContain('buildPlaybookRestorePayload');
    expect(source).toContain('dashboardApi.archivePlaybook');
    expect(source).toContain('dashboardApi.restorePlaybook');
    expect(source).toContain('dashboardApi.deletePlaybook');
    expect(source).toContain('Archive Playbook');
    expect(source).toContain('Delete Playbook Revision');
    expect(source).toContain('Delete Revision');
    expect(source).toContain('playbook-danger-zone');
    expect(source).toContain('Danger');
    expect(source).toContain('Delete this playbook revision only when it should be removed permanently');
    expect(source).toContain('Restore');
    expect(source).toContain('max-h-[70vh] max-w-lg overflow-y-auto');
    expect(source).toContain('Playbook lifecycle');
    expect(source).toContain('Shared prompts, role prompts, and runtime defaults are configured elsewhere.');
    expect(source).toContain('Compare past revisions and restore an older workflow structure');
    expect(source).toContain('rounded-2xl border border-border/70 bg-card/80 p-5 shadow-sm');
    expect(source).toContain("variant={selected ? 'secondary' : 'outline'}");
    expect(source).toContain('rounded-xl border border-red-300 bg-red-50/80');
    expect(source).toContain('Resolve these authoring blockers before saving.');
    expect(source).toContain('rounded-xl border border-emerald-300 bg-emerald-50/80');
    expect(source).toContain('onValidationChange={setAuthoringValidationIssues}');
    expect(source).toContain('Save Playbook');
    expect(source).not.toContain('Raw JSON');
    expect(source).not.toContain('PlaybookControlCenterCard');
    expect(source).not.toContain('PlaybookEditingActionRailCard');
    expect(source).not.toContain('PlaybookEditOutlineCard');
    expect(source).not.toContain('sticky bottom-4 z-10 xl:hidden');
  });

  it('guards against unsaved changes via beforeunload with dirty tracking on all form fields', () => {
    const source = readSource();
    expect(source).toContain('useUnsavedChanges');
    expect(source).toContain('useUnsavedChanges(isDirty)');
    expect(source).toContain('setIsDirty(false)');
    expect(source).toContain('setIsDirty(true)');
  });
});
