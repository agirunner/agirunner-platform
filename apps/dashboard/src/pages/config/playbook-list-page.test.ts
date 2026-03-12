import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './playbook-list-page.tsx'), 'utf8');
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
    expect(source).toContain('Back to playbook library');
  });
});
