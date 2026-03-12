import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './playbook-list-page.tsx'), 'utf8');
}

describe('playbook list page source', () => {
  it('uses structured authoring sections instead of raw definition JSON editing', () => {
    const source = readSource();
    expect(source).toContain('Team Roles');
    expect(source).toContain('Board Columns');
    expect(source).toContain('Workflow Stages');
    expect(source).toContain('Orchestrator Parallelism');
    expect(source).toContain('Runtime Controls');
    expect(source).toContain('Playbook Parameters');
    expect(source).not.toContain('Definition JSON');
    expect(source).toContain('buildPlaybookDefinition(');
  });
});
