import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './project-knowledge-tab.tsx'), 'utf8');
}

describe('project knowledge tab source', () => {
  it('disables save when local knowledge or memory validation errors are present, matching settings-tab gating', () => {
    const source = readSource();

    expect(source).toContain("const knowledgeValidationError = readStructuredValidationError(knowledgeDrafts, 'Project knowledge');");
    expect(source).toContain("const memoryValidationError = readStructuredValidationError(memoryDrafts, 'Project memory');");
    expect(source).toContain('normalizeMemoryDrafts');
    expect(source).toContain('disabled={saveMutation.isPending || Boolean(validationError)}');
    expect(source).toContain('syncProjectMemory');
    expect(source).toContain('Knowledge and memory saved.');
    expect(source).toContain('memoryDrafts={memoryDrafts}');
  });

  it('keeps local knowledge and memory summaries aligned with draft edits before the page is saved', () => {
    const source = readSource();

    expect(source).toContain('referenceSummary={buildReferenceDraftSummary(projectContext, knowledgeDrafts.length)}');
    expect(source).toContain('memorySummary={buildMemoryDraftSummary(memoryDrafts.length)}');
    expect(source).toContain('function buildReferenceDraftSummary(');
    expect(source).toContain('function buildMemoryDraftSummary(memoryCount: number): string {');
  });

  it('removes memory entries only through the page-level save sync instead of per-row persistence', () => {
    const source = readSource();

    expect(source).toContain('if (!hasNext && hasCurrent) {');
    expect(source).toContain('dashboardApi.removeProjectMemory(');
    expect(source).not.toContain("return [{ key, value: null }];");
  });
});
