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
    expect(source).toContain('max-w-7xl');
    expect(source).toContain('sticky bottom-4');
    expect(source).toContain('xl:sticky xl:top-6');
    expect(source).not.toContain('DialogContent');
    expect(source).not.toContain('Definition JSON');
    expect(source).toContain('buildPlaybookDefinition(');
    expect(source).toContain('Manage');
    expect(source).toContain('Archived playbooks stay available for review and revision history');
    expect(source).toContain('dashboardApi.archivePlaybook');
    expect(source).toContain('dashboardApi.restorePlaybook');
    expect(source).toContain('dashboardApi.deletePlaybook');
    expect(source).toContain('Delete this playbook revision?');
    expect(source).toContain('Delete revision');
    expect(source).toContain('Restore');
    expect(source).toContain('Back to playbook library');
    expect(source).toContain('Library filters');
    expect(source).toContain('Active revisions');
    expect(source).toContain('Lifecycle mix');
    expect(source).toContain('statusFilter');
    expect(source).toContain('lifecycleFilter');
  });
});
