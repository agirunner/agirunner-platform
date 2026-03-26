import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './workspace-detail-shell.tsx'), 'utf8');
}

describe('workspace detail shell source', () => {
  it('uses a plain page header with the active badge and the remaining tab controls', () => {
    const source = readSource();

    expect(source).toContain('export function WorkspaceDetailShell');
    expect(source).toContain('headerState.quickActions.map((action)');
    expect(source).toContain('SelectTrigger aria-label="Select workspace workspace tab"');
    expect(source).toContain('TabsList');
    expect(source).toContain('TabsTrigger');
    expect(source).toContain('grid-cols-2');
    expect(source).toContain("{workspace.is_active ? 'Active' : 'Inactive'}");
    expect(source).not.toContain('Card className="border-border/70 shadow-none"');
    expect(source).not.toContain('CardHeader');
    expect(source).not.toContain('headerState.activeTab.label');
    expect(source).not.toContain('grid-cols-3');
    expect(source).not.toContain('overviewContent');
    expect(source).not.toContain('Workspace workspace');
  });

  it('matches the playbook-style workspace title treatment without grouped background chrome', () => {
    const source = readSource();

    expect(source).toContain('className="text-2xl font-semibold"');
    expect(source).not.toContain('className="text-lg font-semibold tracking-tight"');
    expect(source).toContain('space-y-3');
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
