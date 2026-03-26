import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './workspace-detail-shell.tsx'), 'utf8');
}

describe('workspace detail shell source', () => {
  it('owns the shared header chrome, quick actions, and the remaining tab controls', () => {
    const source = readSource();

    expect(source).toContain('export function WorkspaceDetailShell');
    expect(source).toContain('headerState.quickActions.map((action)');
    expect(source).toContain('headerState.activeTab.label');
    expect(source).toContain('SelectTrigger aria-label="Select workspace workspace tab"');
    expect(source).toContain('TabsList');
    expect(source).toContain('TabsTrigger');
    expect(source).toContain('grid-cols-2');
    expect(source).not.toContain('grid-cols-3');
    expect(source).not.toContain('overviewContent');
    expect(source).not.toContain('Workspace workspace');
  });

  it('keeps the workspace title size compact across the remaining tabs', () => {
    const source = readSource();

    expect(source).not.toContain("'text-2xl font-semibold tracking-tight'");
    expect(source).toContain('className="text-lg font-semibold tracking-tight"');
  });

  it('keeps the settings and knowledge panels together in one shell component', () => {
    const source = readSource();

    expect(source).toContain('<TabsContent value="settings">');
    expect(source).toContain('<TabsContent value="knowledge">');
    expect(source).toContain('props.settingsContent');
    expect(source).toContain('props.knowledgeContent');
    expect(source).not.toContain('automationContent');
  });
});
