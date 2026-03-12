import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './project-artifact-browser-page.tsx'), 'utf8');
}

describe('project artifact browser page source', () => {
  it('uses the dedicated project artifact explorer instead of the generic content browser', () => {
    const source = readSource();
    expect(source).toContain('ProjectArtifactExplorerPanel');
    expect(source).toContain('showHeader');
    expect(source).not.toContain('ContentBrowserSurface');
  });
});
