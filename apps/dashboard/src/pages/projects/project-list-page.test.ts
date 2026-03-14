import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return [
    './project-list-page.tsx',
    './project-list-page.cards.tsx',
    './project-list-page.dialogs.tsx',
    './project-list-page.support.ts',
  ]
    .map((path) => readFileSync(resolve(import.meta.dirname, path), 'utf8'))
    .join('\n');
}

describe('project list page source', () => {
  it('keeps the list focused on simplified cards and a single inactive toggle', () => {
    const source = readSource();
    expect(source).toContain('Show inactive');
    expect(source).toContain('Hide inactive');
    expect(source).toContain('Sort projects');
    expect(source).toContain('Recent activity');
    expect(source).toContain('Project name');
    expect(source).toContain('Workflow volume');
    expect(source).toContain('Newest first');
    expect(source).toContain('A → Z');
    expect(source).toContain('Most workflows');
    expect(source).toContain('active workflow');
    expect(source).toContain('completed');
    expect(source).toContain('Needs attention');
    expect(source).toContain('Active');
    expect(source).toContain('Inactive');
    expect(source).not.toContain('Search projects');
    expect(source).not.toContain('Workspace coverage');
    expect(source).not.toContain('Repository posture');
    expect(source).not.toContain('Operator next step');
    expect(source).not.toContain('ProjectListPackets');
    expect(source).not.toContain('Inactive projects are hidden by default');
    expect(source).toContain('No workflows yet');
  });

  it('routes the card surface to project detail tabs and keeps list actions labeled', () => {
    const source = readSource();
    expect(source).toContain('const projectLinkState = { projectLabel: props.project.name };');
    expect(source).toContain('to={`/projects/${props.project.id}`}');
    expect(source).toContain('state={projectLinkState}');
    expect(source).toContain("const PROJECT_WORKSPACE_LINKS = [");
    expect(source).toContain("{ label: 'Settings', tab: 'settings' }");
    expect(source).toContain("{ label: 'Knowledge', tab: 'knowledge' }");
    expect(source).toContain("{ label: 'Automation', tab: 'automation' }");
    expect(source).toContain("{ label: 'Delivery', tab: 'delivery' }");
    expect(source).toContain('to={`/projects/${props.project.id}?tab=${workspace.tab}`}');
    expect(source).toContain('Open workspace');
    expect(source).toContain('Edit basics');
    expect(source).toContain('Delete');
    expect(source).not.toContain('text-foreground/80');
    expect(source).not.toContain('Summary');
    expect(source).not.toContain('CompactSignalPill');
    expect(source).not.toContain('Workspace entry points');
    expect(source).not.toContain('Edit details');
  });

  it('keeps project dialogs on the shared api client and scroll-safe', () => {
    const dialogSource = readFileSync(
      resolve(import.meta.dirname, './project-list-page.dialogs.tsx'),
      'utf8',
    );
    expect(dialogSource).toContain('dashboardApi.deleteProject');
    expect(dialogSource).toContain('dashboardApi.patchProject');
    expect(dialogSource).toContain('dashboardApi.createProject');
    expect(dialogSource).toContain('max-h-[calc(100vh-4rem)] overflow-y-auto');
    expect(dialogSource).not.toContain('await fetch(');
    expect(dialogSource).not.toContain('API_BASE_URL');
    expect(dialogSource).not.toContain('getAuthHeaders');
  });
});
