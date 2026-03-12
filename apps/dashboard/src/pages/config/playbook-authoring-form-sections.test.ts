import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(
    resolve(import.meta.dirname, './playbook-authoring-form-sections.tsx'),
    'utf8',
  );
}

describe('playbook authoring form sections source', () => {
  it('uses structured controls for known stage and parameter choices', () => {
    const source = readSource();
    expect(source).toContain('MultiChoiceButtonsControl');
    expect(source).toContain('SelectWithCustomControl');
    expect(source).toContain('TypedParameterValueControl');
    expect(source).toContain('Add team roles above to make them selectable here.');
    expect(source).toContain('project.repository_url');
    expect(source).toContain('project.settings.default_branch');
    expect(source).toContain('project.credentials.git_token');
  });
});
