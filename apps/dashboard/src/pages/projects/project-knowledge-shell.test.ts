import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(filename: string) {
  return readFileSync(resolve(import.meta.dirname, filename), 'utf8');
}

describe('project knowledge surface source', () => {
  it('keeps reference material, project memory, and run content in one stacked knowledge workspace', () => {
    const source = readSource('./project-knowledge-shell.tsx');

    expect(source).toContain("type KnowledgePanelValue = 'reference' | 'memory' | 'runContent'");
    expect(source).toContain('<KnowledgeSection');
    expect(source).toContain("label: 'Reference material'");
    expect(source).toContain("label: 'Project memory'");
    expect(source).toContain("label: 'Run content'");
    expect(source).toContain('referenceContent: ReactNode;');
    expect(source).not.toContain('<TabsList');
    expect(source).not.toContain('<TabsContent');
  });

  it('opens reference material by default and removes route-hub call-to-action clutter', () => {
    const source = readSource('./project-knowledge-shell.tsx');

    expect(source).toContain('Knowledge workspace');
    expect(source).toContain('project reference material, project memory, and scoped run content');
    expect(source).toContain("useState<KnowledgePanelValue | null>('reference')");
    expect(source).toContain('current === value ? null : value');
    expect(source).not.toContain('Start here');
    expect(source).not.toContain('Open documents');
    expect(source).not.toContain('<Link');
  });

  it('keeps the reference, memory, and run content tools available without bringing back duplicate wrapper headers', () => {
    const specSource = readSource('./project-spec-tab.tsx');
    const memorySource = readSource('./project-detail-memory-tab.tsx');
    const contentSource = readSource('./content-browser-page.tsx');

    expect(specSource).toContain('useState<SpecSection | null>(null)');
    expect(specSource).toContain('Start with the section you need to change');
    expect(memorySource).toContain('useState<MemorySectionKey | null>(null)');
    expect(memorySource).toContain('Memory at a glance');
    expect(memorySource).toContain('Start with Current memory to review reusable context');
    expect(contentSource).toContain('Document Operator Controls');
    expect(contentSource).toContain('Artifact Operator Controls');
    expect(contentSource).toContain('showHeader?: boolean;');
    expect(contentSource).toContain('props.showHeader === false ? null');
  });
});
