import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return [
    './workspace-list-page.tsx',
    './workspace-list-page.table.tsx',
    './workspace-list-page.dialogs.tsx',
    './workspace-list-page.support.ts',
    '../../components/list-pagination.tsx',
  ]
    .map((path) => readFileSync(resolve(import.meta.dirname, path), 'utf8'))
    .join('\n');
}

describe('workspace list page source', () => {
  it('uses a compact library toolbar with search, status, and sort controls', () => {
    const source = readSource();
    expect(source).toContain('Create and manage workspaces, then open one to edit settings and knowledge.');
    expect(source).toContain('Search workspaces');
    expect(source).toContain('Workspace status');
    expect(source).toContain('All');
    expect(source).toContain('Inactive');
    expect(source).toContain('Sort workspaces');
    expect(source).toContain('Recent activity');
    expect(source).toContain('Workspace name');
    expect(source).toContain('Workflow volume');
    expect(source).toContain('Newest first');
    expect(source).toContain('A → Z');
    expect(source).toContain('Most workflows');
    expect(source).toContain('active workflow');
    expect(source).toContain('workflow completed');
    expect(source).toContain('Active');
    expect(source).toContain('Inactive');
    expect(source).toContain('workspace');
    expect(source).toContain('active ·');
    expect(source).not.toContain('Workspace coverage');
    expect(source).not.toContain('Repository posture');
    expect(source).not.toContain('Operator next step');
    expect(source).not.toContain('WorkspaceListPackets');
    expect(source).not.toContain('Show inactive');
    expect(source).not.toContain('Hide inactive');
    expect(source).toContain('No workflows yet');
  });

  it('uses a paged table surface with a single manage action and compact detail rows', () => {
    const source = readSource();
    expect(source).toContain('const workspaceLinkState = { workspaceLabel: props.workspace.name };');
    expect(source).toContain('to={`/design/workspaces/${props.workspace.id}`}');
    expect(source).toContain('state={workspaceLinkState}');
    expect(source).toContain('className="font-medium text-foreground underline-offset-4 transition hover:underline"');
    expect(source).toContain('<TableCell className="text-sm text-foreground">{workspaceMetrics}</TableCell>');
    expect(source).toContain('<TableCell className="text-sm text-foreground">{activityLabel}</TableCell>');
    expect(source).toContain('Manage');
    expect(source).toContain('WorkspaceListTable');
    expect(source).toContain('Page size');
    expect(source).toContain('Showing');
    expect(source).toContain('Previous');
    expect(source).toContain('Next');
    expect(source).toContain('Storage');
    expect(source).toContain('Workflows');
    expect(source).toContain('Last activity');
    expect(source).toContain('Workspace details');
    expect(source).toContain('Workspace storage');
    expect(source).not.toContain('WorkspaceListGrid');
    expect(source).not.toContain('?tab=settings');
    expect(source).not.toContain('?tab=knowledge');
    expect(source).not.toContain('?tab=automation');
    expect(source).not.toContain('?tab=delivery');
    expect(source).not.toContain('Open workspace');
    expect(source).not.toContain('Workspace actions');
    expect(source).not.toContain('DropdownMenuTrigger asChild');
    expect(source).not.toContain('Edit basics');
    expect(source).not.toContain('text-foreground/80');
    expect(source).not.toContain('CompactSignalPill');
    expect(source).not.toContain('Workspace entry points');
    expect(source).not.toContain('Edit details');
    expect(source).not.toContain('buildWorkspaceDescription');
    expect(source).not.toContain('hover:text-foreground');
    expect(source).not.toContain('<TableCell className="text-sm text-muted">{workspaceMetrics}</TableCell>');
    expect(source).not.toContain('<TableCell className="text-sm text-muted">{activityLabel}</TableCell>');
    expect(source).not.toContain('Description');
    expect(source).not.toContain('No description provided.');
  });

  it('keeps workspace dialogs on the shared api client and scroll-safe', () => {
    const dialogSource = readFileSync(
      resolve(import.meta.dirname, './workspace-list-page.dialogs.tsx'),
      'utf8',
    );
    expect(dialogSource).toContain('dashboardApi.deleteWorkspace');
    expect(dialogSource).toContain('dashboardApi.createWorkspace');
    expect(dialogSource).toContain('max-h-[calc(100vh-4rem)] overflow-y-auto');
    expect(dialogSource).toContain('navigate(`/design/workspaces/${created.id}`)');
    expect(dialogSource).toContain("navigate('/design/workspaces')");
    expect(dialogSource).not.toContain('?tab=settings');
    expect(dialogSource).not.toContain('Repository URL');
    expect(dialogSource).not.toContain('repository_url');
    expect(dialogSource).not.toContain('EditWorkspaceDialog');
    expect(dialogSource).not.toContain('await fetch(');
    expect(dialogSource).not.toContain('API_BASE_URL');
    expect(dialogSource).not.toContain('getAuthHeaders');
  });
});
