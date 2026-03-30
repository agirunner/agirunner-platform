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
    expect(source).toContain('aria-label="Playbook active"');
    expect(source).toContain('This playbook is staged as inactive. Save the page to stop new workflow launches');
    expect(source).toContain('dashboardApi.deletePlaybook');
    expect(source).toContain('Delete Playbook Revision');
    expect(source).toContain('Delete Revision');
    expect(source).toContain('playbook-danger-zone');
    expect(source).toContain('Danger');
    expect(source).not.toContain('Delete this playbook revision only when it should be removed permanently');
    expect(source).toContain('max-h-[70vh] max-w-lg overflow-y-auto');
    expect(source).toContain('Playbook lifecycle');
    expect(source).toContain('Playbook Basics');
    expect(source).toContain('Edit the playbook definition, workflow guidance, and workflow goals for this revision.');
    expect(source).toContain('Set the core playbook identity, outcome, and lifecycle for this revision.');
    expect(source).toContain('max-w-full overflow-x-auto whitespace-nowrap text-sm text-muted');
    expect(source).toContain('lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.35fr)]');
    expect(source).toContain('lg:grid-rows-[auto_minmax(0,1fr)]');
    expect(source).not.toContain('lg:grid-cols-[minmax(0,0.95fr),minmax(0,1.35fr)]');
    expect(source).not.toContain('lg:grid-cols-[6rem_minmax(0,1fr)]');
    expect(source).toContain('className="min-h-[220px] h-full lg:min-h-0"');
    expect(source).toContain('Created');
    expect(source).toContain('Updated');
    expect(source).toContain('Compare every saved playbook setting against an earlier revision.');
    expect(source).toContain('SelectTrigger aria-label="Playbook lifecycle"');
    expect(source).toContain('FormFeedbackMessage message={saveFormFeedbackMessage}');
    expect(source).toContain('showValidationErrors={hasAttemptedSave}');
    expect(source).not.toContain('Resolve these authoring blockers before saving.');
    expect(source).toContain('rounded-xl border border-emerald-300 bg-emerald-50/80');
    expect(source).toContain('reconcileValidationIssues(currentIssues, nextIssues)');
    expect(source).toContain('Save Playbook');
    expect(source).not.toContain('Archive Playbook');
    expect(source).not.toContain('Description</span>');
    expect(source).not.toContain('Operator-facing catalog copy only.');
    expect(source).not.toContain('buildPlaybookRestorePayload');
    expect(source).not.toContain('Playbook Availability');
    expect(source).not.toContain('Inactive playbooks cannot launch new workflows until you save and reactivate them.');
    expect(source).not.toContain('Raw JSON');
    expect(source).not.toContain('Shared prompts, role prompts, and specialist defaults are configured elsewhere.');
    expect(source).not.toContain('Keep the identity and operating model visible while you edit the process-first');
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

  it('routes playbook launch through the canonical workflows launch dialog instead of a separate page', () => {
    const source = readSource();
    expect(source).toContain("import { buildWorkflowsLaunchHref } from '../workflows/workflows-page.support.js';");
    expect(source).toContain('to={buildWorkflowsLaunchHref({ playbookId: playbook.id })}');
    expect(source).not.toContain('to={`/design/playbooks/${playbook.id}/launch`}');
  });
});
