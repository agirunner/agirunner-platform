import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './playbook-list-page.tsx'), 'utf8');
}

describe('playbook list page source', () => {
  it('uses the shared structured authoring form instead of raw definition JSON editing', () => {
    const source = readSource();
    expect(source).toContain('PlaybookAuthoringForm');
    expect(source).not.toContain('Definition JSON');
    expect(source).toContain('buildPlaybookDefinition(');
    expect(source).toContain('Manage');
    expect(source).toContain('max-h-[90vh] max-w-5xl overflow-y-auto');
  });
});
