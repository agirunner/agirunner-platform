import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './platform-instructions-page.tsx'), 'utf8');
}

describe('platform instructions page source', () => {
  it('uses the shorter Instructions heading in the platform section', () => {
    const source = readSource();
    expect(source).toContain('Instructions');
    expect(source).not.toContain('Platform Instructions');
  });

  it('uses the platform instructions API', () => {
    const source = readSource();
    expect(source).toContain('dashboardApi.getPlatformInstructions()');
    expect(source).toContain('dashboardApi.updatePlatformInstructions');
  });

  it('describes the editor as role-wide system-prompt prepended instructions', () => {
    const source = readSource();
    expect(source).toContain("These instructions are prepended to every agent&apos;s system prompt across all roles.");
    expect(source).not.toContain("These instructions are prepended to every agent&apos;s system prompt across all workflows and workspaces.");
  });

  it('guards against unsaved changes', () => {
    const source = readSource();
    expect(source).toContain('useUnsavedChanges');
  });

  it('is a simple editor without version history or diffs', () => {
    const source = readSource();
    expect(source).toContain('Textarea');
    expect(source).toContain('Save');
    expect(source).toContain('min-h-[65vh]');
    expect(source).not.toContain('Version History');
    expect(source).not.toContain('DiffViewer');
    expect(source).not.toContain('Restore');
  });
});
