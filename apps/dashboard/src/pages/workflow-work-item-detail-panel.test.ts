import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(
    resolve(import.meta.dirname, './workflow-work-item-detail-panel.tsx'),
    'utf8',
  );
}

describe('workflow work item detail panel source', () => {
  it('renders dedicated tabs for steps, memory, artifacts, and event history', () => {
    const source = readSource();
    expect(source).toContain('TabsTrigger value="steps"');
    expect(source).toContain('TabsTrigger value="memory"');
    expect(source).toContain('TabsTrigger value="artifacts"');
    expect(source).toContain('TabsTrigger value="history"');
  });

  it('loads truthful work-item memory and memory history from dashboard api methods', () => {
    const source = readSource();
    expect(source).toContain('listWorkflowWorkItemEvents');
    expect(source).toContain('getWorkflowWorkItemMemory');
    expect(source).toContain('getWorkflowWorkItemMemoryHistory');
    expect(source).toContain('Current memory');
    expect(source).toContain('Memory history');
  });

  it('surfaces milestone operator context with parent-child navigation and grouped task messaging', () => {
    const source = readSource();
    expect(source).toContain('Operator breadcrumb');
    expect(source).toContain('Milestone group summary');
    expect(source).toContain('Operator attention');
    expect(source).toContain('Active footprint');
    expect(source).toContain('Milestone children');
    expect(source).toContain('Open parent milestone');
    expect(source).toContain('children complete');
    expect(source).toContain('Showing execution steps linked to this milestone and its');
    expect(source).toContain('Linked execution steps stay here');
    expect(source).toContain('Operator Flow Controls');
    expect(source).toContain('Reparent under milestone');
    expect(source).toContain('Save Operator Changes');
    expect(source).toContain('Create Child Work Item');
    expect(source).toContain('Approve Step');
    expect(source).toContain('Request Changes');
    expect(source).toContain('Retry Step');
    expect(source).toContain('Focus work item');
    expect(source).toContain('Open step record');
    expect(source).toContain('Stage group');
    expect(source).toContain('Open child work-item flow');
    expect(source).toContain('dashboardApi.updateWorkflowWorkItem');
    expect(source).toContain('dashboardApi.createWorkflowWorkItem');
    expect(source).toContain('dashboardApi.approveTask');
    expect(source).toContain('dashboardApi.requestTaskChanges');
    expect(source).toContain('dashboardApi.retryTask');
  });

  it('links artifacts through the dashboard preview permalink instead of direct storage urls', () => {
    const source = readSource();
    expect(source).toContain('buildArtifactPermalink');
    expect(source).toContain('Preview artifact');
    expect(source).not.toContain('access_url ?? artifact.download_url');
  });
});
