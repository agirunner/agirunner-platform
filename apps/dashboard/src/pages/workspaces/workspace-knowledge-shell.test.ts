import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(filename: string) {
  return readFileSync(resolve(import.meta.dirname, filename), 'utf8');
}

describe('workspace knowledge surface source', () => {
  it('keeps reference material, workspace memory, and run content in one stacked knowledge workspace', () => {
    const source = readSource('./workspace-knowledge-shell.tsx');

    expect(source).toContain("type KnowledgePanelValue = 'reference' | 'artifacts' | 'memory'");
    expect(source).toContain('<KnowledgeSection');
    expect(source).toContain("label: 'Workspace Context & Knowledge'");
    expect(source).toContain("label: 'Workspace Artifacts'");
    expect(source).toContain("label: 'Workspace Memory'");
    expect(source).toContain('referenceContent: ReactNode;');
    expect(source).toContain('artifactContent: ReactNode;');
    expect(source).not.toContain('<TabsList');
    expect(source).not.toContain('<TabsContent');
  });

  it('starts collapsed by default and trims the top wrapper copy to a single calm intro', () => {
    const source = readSource('./workspace-knowledge-shell.tsx');

    expect(source).toContain('Knowledge');
    expect(source).toContain('Use Knowledge for curated context, Workspace Artifacts for generated outputs, and Workspace Memory for evolving notes.');
    expect(source).toContain('className="sr-only">{props.overview.summary}</p>');
    expect(source).toContain('useState<KnowledgePanelValue | null>(null)');
    expect(source).toContain('current === value ? null : value');
    expect(source).not.toContain('Start here');
    expect(source).not.toContain('Open documents');
    expect(source).not.toContain('<Link');
  });

  it('keeps section headers compact so the page stays action-oriented', () => {
    const source = readSource('./workspace-knowledge-shell.tsx');

    expect(source).toContain('Curated workspace context, policies, and reusable facts stay here.');
    expect(source).toContain('Workspace-owned files stay here for upload, review, and removal.');
    expect(source).toContain('Evolving notes and learned state stay here as work progresses.');
    expect(source).toContain('max-w-3xl text-sm leading-5 text-muted');
    expect(source).not.toContain('guidance:');
    expect(source).not.toContain('formatSectionSummary');
  });

  it('accepts local draft summary overrides so the shell reflects unsaved page edits immediately', () => {
    const source = readSource('./workspace-knowledge-shell.tsx');

    expect(source).toContain('referenceSummary?: string;');
    expect(source).toContain('artifactSummary?: string;');
    expect(source).toContain('memorySummary?: string;');
    expect(source).toContain("reference: props.referenceSummary ?? buildReferenceSummary(props.overview),");
    expect(source).toContain('props.memorySummary');
    expect(source).toContain("getPacketSummary(props.overview, 'Shared memory')");
  });

  it('keeps the reference, memory, and run content tools available without bringing back duplicate wrapper headers', () => {
    const specSource = readSource('./workspace-spec-tab.tsx');
    const memorySource = readSource('./workspace-detail-memory-tab.tsx');

    expect(specSource).toContain('Workspace Context');
    expect(specSource).toContain('Key/Value pairs');
    expect(specSource).toContain('Use simple string or JSON values for reusable workspace knowledge.');
    expect(memorySource).toContain('Add memory entry');
    expect(memorySource).toContain('Memory is for evolving notes and learned state.');
  });
});
