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
  it('uses structured controls for known stage and parameter choices and exposes explicit reordering controls', () => {
    const source = readSource();
    expect(source).toContain('validateBoardColumnsDraft');
    expect(source).toContain('MultiChoiceButtonsControl');
    expect(source).toContain('SelectWithCustomControl');
    expect(source).toContain('ToggleCard');
    expect(source).toContain('TypedParameterValueControl');
    expect(source).toContain('moveDraftItem');
    expect(source).toContain('Move Earlier');
    expect(source).toContain('Move Later');
    expect(source).toContain('Remove Role');
    expect(source).toContain('Resolve board-column blockers before save.');
    expect(source).toContain(
      'Use a stable slug-style ID. This is what automation, stages, and board links reference.',
    );
    expect(source).toContain(
      'Labels should match the board language operators use in workflow views.',
    );
    expect(source).toContain('No optional verification tools enabled.');
    expect(source).toContain('Column ${index + 1} of ${columnCount}');
    expect(source).toContain('Stage ${index + 1} of ${stageCount}');
    expect(source).toContain('Add team roles above to make them selectable here.');
    expect(source).toContain('project.repository_url');
    expect(source).toContain('project.settings.default_branch');
    expect(source).toContain('project.credentials.git_token');
    expect(source).not.toContain('type="checkbox"');
  });
});
