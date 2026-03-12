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
  it('renders dedicated tabs for tasks, memory, artifacts, and event history', () => {
    const source = readSource();
    expect(source).toContain('TabsTrigger value="tasks"');
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
    expect(source).toContain('Milestone children');
    expect(source).toContain('Parent milestone:');
    expect(source).toContain('children complete');
    expect(source).toContain('Showing tasks linked to this milestone and its');
  });

  it('links artifacts through the dashboard preview permalink instead of direct storage urls', () => {
    const source = readSource();
    expect(source).toContain('buildArtifactPermalink');
    expect(source).toContain('Preview artifact');
    expect(source).not.toContain('access_url ?? artifact.download_url');
  });
});
