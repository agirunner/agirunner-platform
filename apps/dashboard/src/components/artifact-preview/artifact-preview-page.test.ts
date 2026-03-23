import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return [
    './artifact-preview-page.tsx',
    './artifact-preview-page.sections.tsx',
    './artifact-preview-page.support.ts',
  ]
    .map((path) => readFileSync(resolve(import.meta.dirname, path), 'utf8'))
    .join('\n');
}

describe('artifact preview page source', () => {
  it('renders a dedicated operator shell with metadata cards and preview workspace framing', () => {
    const source = readSource();
    expect(source).toContain('data-testid="artifact-preview-surface"');
    expect(source).toContain('data-testid="artifact-preview-metadata-grid"');
    expect(source).toContain('Artifact preview');
    expect(source).toContain('Preview workspace');
    expect(source).toContain('ArtifactMetadataCard');
    expect(source).toContain('Back to work-item flow');
    expect(source).toContain('Open step diagnostics');
    expect(source).toContain('Operator flow');
    expect(source).toContain('Step diagnostics');
    expect(source).toContain('Copy Permalink');
    expect(source).toContain('Download');
    expect(source).toContain('Open Permalink');
  });

  it('surfaces explicit preview states for loading, failure, binary, and size-limited artifacts', () => {
    const source = readSource();
    expect(source).toContain('Loading artifact preview');
    expect(source).toContain('Artifact preview unavailable');
    expect(source).toContain('Download-only artifact');
    expect(source).toContain('Inline preview limit reached');
    expect(source).toContain('Inline preview failed');
    expect(source).toContain('Return to the operator flow or open step diagnostics');
    expect(source).toContain('Loading inline preview');
    expect(source).toContain('PreviewStateNotice');
  });

  it('keeps tabbed rendered and raw inspection with stronger preview styling', () => {
    const source = readSource();
    expect(source).toContain('data-testid="artifact-preview-tabs"');
    expect(source).toContain('TabsTrigger value="rendered"');
    expect(source).toContain('TabsTrigger value="raw"');
    expect(source).toContain('prose prose-slate');
    expect(source).toContain('min-h-[320px]');
    expect(source).toContain('bg-slate-950');
  });
});
