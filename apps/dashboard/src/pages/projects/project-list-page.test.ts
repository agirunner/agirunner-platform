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
  it('adds operator summary packets and explicit next-action guidance', () => {
    const source = readSource();
    expect(source).toContain('Project operator surface');
    expect(source).toContain('Workspace coverage');
    expect(source).toContain('Repository posture');
    expect(source).toContain('Operator next step');
    expect(source).toContain('Open project');
  });

  it('replaces icon-only project actions with labeled controls', () => {
    const source = readSource();
    expect(source).toContain('Edit details');
    expect(source).toContain('Delete project');
    expect(source).not.toContain('window.location.assign');
    expect(source).not.toContain('size="icon"');
  });

  it('keeps project creation and editing dialogs scroll-safe', () => {
    const source = readSource();
    expect(source).toContain('max-h-[calc(100vh-4rem)] overflow-y-auto');
    expect(source).toContain('What operators should know about this workspace...');
    expect(source).toContain('Connect the repository so specialists can clone');
  });

  it('uses the shared dashboard api client instead of raw fetch for all project mutations', () => {
    const dialogSource = readFileSync(
      resolve(import.meta.dirname, './project-list-page.dialogs.tsx'),
      'utf8',
    );
    expect(dialogSource).toContain('dashboardApi.deleteProject');
    expect(dialogSource).toContain('dashboardApi.patchProject');
    expect(dialogSource).toContain('dashboardApi.createProject');
    expect(dialogSource).not.toContain('await fetch(');
    expect(dialogSource).not.toContain('API_BASE_URL');
    expect(dialogSource).not.toContain('getAuthHeaders');
  });
});
