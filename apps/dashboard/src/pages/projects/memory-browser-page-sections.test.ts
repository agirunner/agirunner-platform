import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(
    resolve(import.meta.dirname, './memory-browser-page-sections.tsx'),
    'utf8',
  );
}

describe('memory browser page sections source', () => {
  it('adapts the header for project-scoped memory exploration', () => {
    const source = readSource();

    expect(source).toContain("const title = props.scopedProjectId ? 'Project Memory Explorer' : 'Memory Browser'");
    expect(source).toContain('Open Artifact Explorer');
    expect(source).toContain('Open Workflow Board');
    expect(source).toContain('without leaving the current project');
  });
});
