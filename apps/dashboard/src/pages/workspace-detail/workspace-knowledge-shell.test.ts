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
    expect(source).toContain(
      'Workspace artifacts and seeded memory are available to specialists operating in this',
    );
    expect(source).toContain(
      'Depending on the workflow, specialists may also add artifacts and memory as',
    );
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

    expect(source).toContain('buildArtifactSummary');
    expect(source).toContain('buildMemorySummary');
    expect(source).toContain("getPacketValue(overview, 'Shared memory')");
    expect(source).toContain('Upload and manage files that stay scoped to this workspace.');
    expect(source).toContain('Track shared key/value context the workspace learns over time.');
    expect(source).not.toContain(
      'Workspace-owned files stay here for upload, review, and removal.',
    );
    expect(source).not.toContain('Evolving notes and learned state stay here as work progresses.');
    expect(source).toContain('max-w-3xl text-sm leading-5 text-muted');
    expect(source).not.toContain('description:');
    expect(source).not.toContain('{props.description}');
    expect(source).not.toContain('guidance:');
    expect(source).not.toContain('formatSectionSummary');
    expect(source).toContain('CardContent className="space-y-3 px-4 pb-4 pt-0"');
    expect(source).not.toContain('CardContent className="space-y-3 border-t border-border/70');
  });

  it('accepts local memory summary overrides so the shell reflects unsaved page edits immediately', () => {
    const source = readSource('./workspace-knowledge-shell.tsx');

    expect(source).toContain('artifactSummary?: string;');
    expect(source).toContain('memorySummary?: string;');
    expect(source).toContain('props.memorySummary');
    expect(source).toContain('buildMemorySummary(props.overview)');
    expect(source).not.toContain('workspaceId: string;');
  });

  it('keeps memory and run content tools available without bringing back duplicate wrapper headers', () => {
    const memorySource = readSource('./workspace-detail-memory-tab.tsx');

    expect(memorySource).toContain('Add memory entry');
    expect(memorySource).toContain('Key/Value pairs');
    expect(memorySource).not.toContain('Workspace Memory');
    expect(memorySource).not.toContain('Memory is for evolving notes and learned state.');
  });
});
