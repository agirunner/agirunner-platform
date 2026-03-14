import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './project-memory-browser-page.tsx'), 'utf8');
}

describe('project memory browser page source', () => {
  it('adds a project-scoped header while suppressing the duplicate inner memory header', () => {
    const source = readSource();

    expect(source).toContain('ProjectScopedSurfaceHeader');
    expect(source).toContain('workspace="memory"');
    expect(source).toContain('<MemoryBrowserSurface scopedProjectId={projectId} showHeader={false} />');
  });
});
