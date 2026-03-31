import { describe, expect, it } from 'vitest';

import { buildArtifactPermalink, readArtifactPreviewReturnState } from './artifact-preview-navigation.js';

describe('artifact preview navigation', () => {
  it('builds plain and context-aware artifact preview links', () => {
    expect(buildArtifactPermalink('task-1', 'artifact-1')).toBe(
      '/artifacts/tasks/task-1/artifact-1',
    );
    expect(
      buildArtifactPermalink('task-1', 'artifact-1', {
        returnTo: '/design/workspaces/workspace-1/artifacts?workflow_id=workflow-1',
        returnSource: 'workspace-artifacts',
      }),
    ).toBe(
      '/artifacts/tasks/task-1/artifact-1?return_to=%2Fdesign%2Fworkspaces%2Fworkspace-1%2Fartifacts%3Fworkflow_id%3Dworkflow-1&return_source=workspace-artifacts',
    );
  });

  it('reads preview return context from query params', () => {
    const searchParams = new URLSearchParams(
      'return_to=%2Fdesign%2Fworkspaces%2Fworkspace-1%2Fartifacts%3Fworkflow_id%3Dworkflow-1&return_source=workspace-artifacts',
    );
    expect(readArtifactPreviewReturnState(searchParams)).toEqual({
      returnTo: '/design/workspaces/workspace-1/artifacts?workflow_id=workflow-1',
      returnSource: 'workspace-artifacts',
    });
  });
});
