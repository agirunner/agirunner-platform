import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return [
    './workspace-list-page.tsx',
    './workspace-list-page.cards.tsx',
    './workspace-list-page.dialogs.tsx',
    './workspace-list-page.support.ts',
  ]
    .map((path) => readFileSync(resolve(import.meta.dirname, path), 'utf8'))
    .join('\n');
}

describe('workspace list page source', () => {
  it('keeps the list focused on simplified cards and a single inactive toggle', () => {
    const source = readSource();
    expect(source).toContain('Show inactive');
    expect(source).toContain('Hide inactive');
    expect(source).toContain('Sort workspaces');
    expect(source).toContain('Recent activity');
    expect(source).toContain('Workspace name');
    expect(source).toContain('Workflow volume');
    expect(source).toContain('Newest first');
    expect(source).toContain('A → Z');
    expect(source).toContain('Most workflows');
    expect(source).toContain('active workflow');
    expect(source).toContain('completed');
    expect(source).toContain('Active');
    expect(source).toContain('Inactive');
    expect(source).not.toContain('Search workspaces');
    expect(source).not.toContain('Workspace coverage');
    expect(source).not.toContain('Repository posture');
    expect(source).not.toContain('Operator next step');
    expect(source).not.toContain('WorkspaceListPackets');
    expect(source).not.toContain('Inactive workspaces are hidden by default');
    expect(source).toContain('No workflows yet');
  });

  it('routes the card surface to workspace detail tabs and keeps list actions labeled', () => {
    const source = readSource();
    expect(source).toContain('const workspaceLinkState = { workspaceLabel: props.workspace.name };');
    expect(source).toContain('to={`/workspaces/${props.workspace.id}`}');
    expect(source).toContain('state={workspaceLinkState}');
    expect(source).toContain("const WORKSPACE_WORKSPACE_LINKS = [");
    expect(source).toContain("{ label: 'Settings', tab: 'settings' }");
    expect(source).toContain("{ label: 'Knowledge', tab: 'knowledge' }");
    expect(source).toContain("{ label: 'Automation', tab: 'automation' }");
    expect(source).toContain("{ label: 'Delivery', tab: 'delivery' }");
    expect(source).toContain('to={`/workspaces/${props.workspace.id}?tab=${workspace.tab}`}');
    expect(source).toContain('Open workspace');
    expect(source).not.toContain('Workspace actions');
    expect(source).not.toContain('DropdownMenuTrigger asChild');
    expect(source).not.toContain('Edit basics');
    expect(source).not.toContain('text-foreground/80');
    expect(source).not.toContain('Summary');
    expect(source).not.toContain('CompactSignalPill');
    expect(source).not.toContain('Workspace entry points');
    expect(source).not.toContain('Edit details');
  });

  it('keeps workspace dialogs on the shared api client and scroll-safe', () => {
    const dialogSource = readFileSync(
      resolve(import.meta.dirname, './workspace-list-page.dialogs.tsx'),
      'utf8',
    );
    expect(dialogSource).toContain('dashboardApi.deleteWorkspace');
    expect(dialogSource).toContain('dashboardApi.createWorkspace');
    expect(dialogSource).toContain('max-h-[calc(100vh-4rem)] overflow-y-auto');
    expect(dialogSource).toContain('navigate(`/workspaces/${created.id}`)');
    expect(dialogSource).toContain("navigate('/workspaces')");
    expect(dialogSource).not.toContain('?tab=settings');
    expect(dialogSource).not.toContain('Repository URL');
    expect(dialogSource).not.toContain('repository_url');
    expect(dialogSource).not.toContain('EditWorkspaceDialog');
    expect(dialogSource).not.toContain('await fetch(');
    expect(dialogSource).not.toContain('API_BASE_URL');
    expect(dialogSource).not.toContain('getAuthHeaders');
  });
});
