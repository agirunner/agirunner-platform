import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './workspace-knowledge-tab.tsx'), 'utf8');
}

describe('workspace knowledge tab source', () => {
  it('disables save when local memory validation errors are present, matching settings-tab gating', () => {
    const source = readSource();

    expect(source).toContain("const memoryValidationError = readStructuredValidationError(memoryDrafts, 'Workspace memory');");
    expect(source).toContain('normalizeMemoryDrafts');
    expect(source).toContain('disabled={saveMutation.isPending || Boolean(validationError)}');
    expect(source).toContain('syncWorkspaceMemory');
    expect(source).toContain('Workspace memory saved.');
    expect(source).toContain('memoryDrafts={memoryDrafts}');
    expect(source).toContain('Save memory');
    expect(source).not.toContain('Save knowledge');
    expect(source).not.toContain('updateWorkspaceSpec');
  });

  it('keeps local memory summaries aligned with draft edits before the page is saved', () => {
    const source = readSource();

    expect(source).toContain('memorySummary={buildMemoryDraftSummary(memoryDrafts.length)}');
    expect(source).toContain('function buildMemoryDraftSummary(memoryCount: number): string {');
    expect(source).not.toContain('workspaceContext');
    expect(source).not.toContain('knowledgeDrafts');
  });

  it('removes memory entries only through the page-level save sync instead of per-row persistence', () => {
    const source = readSource();

    expect(source).toContain('if (!hasNext && hasCurrent) {');
    expect(source).toContain('dashboardApi.removeWorkspaceMemory(');
    expect(source).not.toContain("return [{ key, value: null }];");
  });
});
