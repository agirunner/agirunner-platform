import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(filename: string) {
  return readFileSync(resolve(import.meta.dirname, filename), 'utf8');
}

describe('workspace knowledge surface source', () => {
  it('keeps workspace artifacts and workspace memory in one stacked knowledge workspace', () => {
    const source = readSource('./workspace-knowledge-shell.tsx');

    expect(source).toContain('<StaticKnowledgeSection');
    expect(source).toContain("label: 'Workspace Artifacts'");
    expect(source).toContain("label: 'Workspace Memory'");
    expect(source).toContain('artifactContent: ReactNode;');
    expect(source).not.toContain('<TabsList');
    expect(source).not.toContain('<TabsContent');
  });

  it('keeps artifacts and memory open by default without per-panel collapse controls', () => {
    const source = readSource('./workspace-knowledge-shell.tsx');

    expect(source).toContain('Knowledge');
    expect(source).toContain('Use Knowledge for workspace artifacts and shared memory.');
    expect(source).toContain('className="sr-only">{props.overview.summary}</p>');
    expect(source).toContain('StaticKnowledgeSection');
    expect(source).not.toContain('useState<KnowledgePanelValue | null>(null)');
    expect(source).not.toContain('current === value ? null : value');
    expect(source).not.toContain('ChevronDown');
    expect(source).not.toContain('aria-expanded={props.isExpanded}');
    expect(source).not.toContain('Start here');
    expect(source).not.toContain('Open documents');
    expect(source).not.toContain('<Link');
  });

  it('keeps section headers compact so the page stays action-oriented', () => {
    const source = readSource('./workspace-knowledge-shell.tsx');

    expect(source).toContain('Workspace-owned files stay here for upload, review, and removal.');
    expect(source).toContain('Evolving notes and learned state stay here as work progresses.');
    expect(source).toContain('max-w-3xl text-sm leading-5 text-muted');
    expect(source).not.toContain('guidance:');
    expect(source).not.toContain('formatSectionSummary');
  });

  it('accepts local memory summary overrides so the shell reflects unsaved page edits immediately', () => {
    const source = readSource('./workspace-knowledge-shell.tsx');

    expect(source).toContain('artifactSummary?: string;');
    expect(source).toContain('memorySummary?: string;');
    expect(source).toContain('props.memorySummary');
    expect(source).toContain("getPacketSummary(props.overview, 'Shared memory')");
    expect(source).not.toContain('workspaceId: string;');
  });

  it('keeps memory and run content tools available without bringing back duplicate wrapper headers', () => {
    const memorySource = readSource('./workspace-detail-memory-tab.tsx');

    expect(memorySource).toContain('Add memory entry');
    expect(memorySource).toContain('Memory is for evolving notes and learned state.');
  });
});
