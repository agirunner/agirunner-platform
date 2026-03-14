import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './project-detail-shell.tsx'), 'utf8');
}

describe('project detail shell source', () => {
  it('owns the shared header chrome, quick actions, and tab controls', () => {
    const source = readSource();

    expect(source).toContain('export function ProjectDetailShell');
    expect(source).toContain('headerState.quickActions.map((action)');
    expect(source).toContain("headerState.mode === 'expanded'");
    expect(source).toContain('headerState.activeTab.label');
    expect(source).toContain('SelectTrigger aria-label="Select project workspace tab"');
    expect(source).toContain('TabsList');
    expect(source).toContain('TabsTrigger');
    expect(source).not.toContain('Project workspace');
  });

  it('keeps all five project tab panels together in one shell component', () => {
    const source = readSource();

    expect(source).toContain('<TabsContent value="overview">');
    expect(source).toContain('<TabsContent value="settings">');
    expect(source).toContain('<TabsContent value="knowledge">');
    expect(source).toContain('<TabsContent value="automation">');
    expect(source).toContain('<TabsContent value="delivery">');
    expect(source).toContain('props.overviewContent');
    expect(source).toContain('props.settingsContent');
    expect(source).toContain('props.knowledgeContent');
    expect(source).toContain('props.automationContent');
    expect(source).toContain('props.deliveryContent');
  });
});
