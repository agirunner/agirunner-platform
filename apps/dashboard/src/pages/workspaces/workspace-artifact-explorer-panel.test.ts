import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './workspace-artifact-explorer-panel.tsx'), 'utf8');
}

describe('workspace artifact explorer panel source', () => {
  it('builds the explorer from the bounded workspace artifact query instead of per-task fan-out', () => {
    const source = readSource();
    expect(source).toContain('dashboardApi.listWorkspaceArtifacts(props.workspaceId');
    expect(source).toContain("per_page: String(WORKSPACE_ARTIFACT_PAGE_SIZE)");
    expect(source).toContain('placeholderData: keepPreviousData');
    expect(source).not.toContain('dashboardApi.getWorkspaceTimeline(props.workspaceId)');
    expect(source).not.toContain('dashboardApi.listTaskArtifacts(taskId)');
  });

  it('uses the dedicated filter card and bulk action bar instead of raw dumps', () => {
    const source = readSource();
    expect(source).toContain('WorkspaceArtifactFilterCard');
    expect(source).toContain('WorkspaceArtifactBulkActionBar');
    expect(source).toContain('buildWorkspaceArtifactScopeChips');
    expect(source).toContain('describeWorkspaceArtifactNextAction');
    expect(source).toContain('selectedStageName');
    expect(source).toContain('selectedRole');
    expect(source).toContain('selectedContentType');
    expect(source).toContain('previewMode');
    expect(source).toContain('createdFrom');
    expect(source).toContain('createdTo');
    expect(source).toContain('loadedArtifactCount={artifacts.length}');
    expect(source).toContain('totalArtifactCount={summary.totalArtifacts}');
    expect(source).toContain("setSort('newest')");
  });

  it('supports quick inspection, bulk download, and explicit page navigation', () => {
    const source = readSource();
    expect(source).toContain('WorkspaceArtifactExplorerAdaptiveLayout');
    expect(source).toContain('WorkspaceArtifactExplorerShell');
    expect(source).toContain('dashboardApi.readTaskArtifactContent');
    expect(source).toContain('dashboardApi.downloadTaskArtifact');
    expect(source).toContain('buildWorkspaceArtifactBrowserPath');
    expect(source).toContain("returnSource: 'workspace-artifacts'");
    expect(source).toContain('pagination={{');
    expect(source).toContain('setPageAndReset(Math.max(page - 1, 1))');
    expect(source).toContain('Downloaded ${artifactsToDownload.length} artifacts');
  });
});
