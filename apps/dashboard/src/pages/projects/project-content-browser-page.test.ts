import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './project-content-browser-page.tsx'), 'utf8');
}

describe('project content browser page source', () => {
  it('keeps the project content route as a thin wrapper over the scoped knowledge surface', () => {
    const source = readSource();

    expect(source).toContain('ProjectScopedSurfaceHeader');
    expect(source).toContain('workspace="documents"');
    expect(source).toContain(
      '<ContentBrowserSurface scopedProjectId={projectId} preferredTab="documents" showHeader={false} />',
    );
  });
});
