import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './project-knowledge-shell.tsx'), 'utf8');
}

describe('project knowledge shell source', () => {
  it('collapses duplicate spec, resource, and tool tabs into one knowledge workspace panel', () => {
    const source = readSource();

    expect(source).toContain("type KnowledgePanelValue = 'workspace' | 'memory' | 'artifacts'");
    expect(source).toContain("value: 'workspace'");
    expect(source).not.toContain("value: 'resources'");
    expect(source).not.toContain("value: 'tools'");
    expect(source).toContain('workspaceContent: ReactNode;');
    expect(source).toContain(
      '<TabsContent value="workspace">{props.workspaceContent}</TabsContent>',
    );
  });

  it('keeps project memory, artifacts, and workflow documents in the same knowledge model', () => {
    const source = readSource();

    expect(source).toContain('Knowledge workspace');
    expect(source).toContain('Open documents');
    expect(source).not.toContain('Open memory explorer');
    expect(source).not.toContain('Open artifact explorer');
    expect(source).not.toContain('WorkspaceMetricCard');
    expect(source).not.toContain('props.overview.packets.map');
  });
});
