import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './project-artifact-explorer-panel.tsx'), 'utf8');
}

describe('project artifact explorer panel source', () => {
  it('builds the explorer from project timeline, workflow tasks, and task artifacts', () => {
    const source = readSource();
    expect(source).toContain("dashboardApi.getProjectTimeline(props.projectId)");
    expect(source).toContain("dashboardApi.listTasks({ workflow_id: workflowId, per_page: '100' })");
    expect(source).toContain('dashboardApi.listTaskArtifacts(taskId)');
    expect(source).toContain('buildProjectArtifactEntries');
    expect(source).toContain('filterProjectArtifactEntries');
  });

  it('uses the dedicated filter card and bulk action bar instead of raw dumps', () => {
    const source = readSource();
    expect(source).toContain('ProjectArtifactFilterCard');
    expect(source).toContain('ProjectArtifactBulkActionBar');
    expect(source).toContain('buildProjectArtifactScopeChips');
    expect(source).toContain('describeProjectArtifactNextAction');
    expect(source).toContain('selectedStageName');
    expect(source).toContain('selectedContentType');
    expect(source).toContain('createdFrom');
    expect(source).toContain('createdTo');
    expect(source).toContain("setSort('newest')");
  });

  it('supports quick inspection with inline preview and bulk download', () => {
    const source = readSource();
    expect(source).toContain('ProjectArtifactExplorerAdaptiveLayout');
    expect(source).toContain('ProjectArtifactExplorerShell');
    expect(source).toContain('dashboardApi.readTaskArtifactContent');
    expect(source).toContain('dashboardApi.downloadTaskArtifact');
    expect(source).toContain('Downloaded ${artifactsToDownload.length} artifacts');
  });
});
