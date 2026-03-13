import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './project-artifact-explorer-layout.tsx'), 'utf8');
}

describe('project artifact explorer adaptive layout source', () => {
  it('uses an explicit mobile browse-vs-inspect split instead of stacking both surfaces', () => {
    const source = readSource();
    expect(source).toContain("const [mobileView, setMobileView] = useState<'browse' | 'inspect'>('browse')");
    expect(source).toContain('TabsTrigger value="browse"');
    expect(source).toContain('TabsTrigger value="inspect"');
    expect(source).toContain('Artifact list');
    expect(source).toContain('Inspect');
  });

  it('keeps the desktop dual-pane layout for large screens', () => {
    const source = readSource();
    expect(source).toContain('hidden gap-6 xl:grid');
    expect(source).toContain('artifactCount');
    expect(source).toContain('selectedArtifactName');
    expect(source).toContain('renderArtifactPreviewMarkup');
    expect(source).toContain('formatArtifactPreviewText');
    expect(source).toContain('ProjectArtifactQuickInspector');
  });
});
