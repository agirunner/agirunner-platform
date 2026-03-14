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

  it('opens reference material by default and trims the top wrapper copy to a single calm intro', () => {
    const source = readSource('./project-knowledge-shell.tsx');

    expect(source).toContain('Knowledge');
    expect(source).toContain('Open the section you need for project reference material, shared memory, or run content.');
    expect(source).toContain('className="sr-only">{props.overview.summary}</p>');
    expect(source).toContain("useState<KnowledgePanelValue | null>('reference')");
    expect(source).toContain('current === value ? null : value');
    expect(source).not.toContain('Start here');
    expect(source).not.toContain('Open documents');
    expect(source).not.toContain('<Link');
  });

  it('keeps section headers compact so the page stays action-oriented', () => {
    const source = readSource('./project-knowledge-shell.tsx');

    expect(source).toContain('Project spec and long-lived reference material stay here.');
    expect(source).toContain('Reusable notes and structured context stay here.');
    expect(source).toContain('Scoped outputs, delivery evidence, and run-generated documents stay here.');
    expect(source).toContain('max-w-3xl text-sm leading-5 text-muted');
    expect(source).not.toContain('guidance:');
    expect(source).not.toContain('formatSectionSummary');
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
