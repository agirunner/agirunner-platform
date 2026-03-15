import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return [
    './playbook-list-page.tsx',
    './playbook-list-page.library.tsx',
    './playbook-list-page.support.ts',
  ]
    .map((path) => readFileSync(resolve(import.meta.dirname, path), 'utf8'))
    .join('\n');
}

describe('playbook list page source', () => {
  it('uses a full-page authoring workspace instead of a long modal', () => {
    const source = readSource();
    expect(source).toContain('PlaybookAuthoringForm');
    expect(source).toContain('playbook-create-workspace');
    expect(source).toContain('Full-page authoring workspace');
    expect(source).toContain('max-w-[88rem]');
    expect(source).toContain('sticky bottom-4');
    expect(source).toContain('xl:sticky xl:top-6');
    expect(source).not.toContain('Definition JSON');
    expect(source).toContain('buildPlaybookDefinition(');
    expect(source).toContain('Manage');
    expect(source).toContain('This family has no active revision. Restore one before launching');
    expect(source).toContain('dashboardApi.archivePlaybook');
    expect(source).toContain('dashboardApi.restorePlaybook');
    expect(source).toContain('Restore');
    expect(source).toContain('Back to playbook library');
    expect(source).toContain('PlaybookLibraryToolbar');
    expect(source).toContain('PlaybookFamilyCard');
    expect(source).toContain('buildPlaybookFamilies');
    expect(source).toContain('filterPlaybookFamilies');
    expect(source).toContain('Most revisions');
    expect(source).toContain('families,');
    expect(source).toContain('statusFilter');
    expect(source).toContain('lifecycleFilter');
    expect(source).toContain('sort');
    expect(source).toContain('validatePlaybookCreateDraft');
    expect(source).toContain('Resolve these blockers before creating the playbook.');
    expect(source).toContain('Slug preview:');
    expect(source).toContain('onValidationChange={setAuthoringValidationIssues}');
    expect(source).not.toContain('PlaybookLibrarySummaryCards');
    expect(source).not.toContain('dashboardApi.deletePlaybook');
    expect(source).not.toContain('Delete Playbook Revision');
  });
});
