import { describe, expect, it } from 'vitest';

import {
  buildArtifactPermalink,
  buildProjectArtifactBrowserPath,
  DEFAULT_PROJECT_ARTIFACT_ROUTE_STATE,
  readArtifactPreviewReturnState,
  readProjectArtifactRouteState,
} from './artifact-navigation.js';

describe('artifact navigation', () => {
  it('builds plain and context-aware artifact preview links', () => {
    expect(buildArtifactPermalink('task-1', 'artifact-1')).toBe(
      '/artifacts/tasks/task-1/artifact-1',
    );
    expect(
      buildArtifactPermalink('task-1', 'artifact-1', {
        returnTo: '/projects/project-1/artifacts?workflow_id=workflow-1',
        returnSource: 'project-artifacts',
      }),
    ).toBe(
      '/artifacts/tasks/task-1/artifact-1?return_to=%2Fprojects%2Fproject-1%2Fartifacts%3Fworkflow_id%3Dworkflow-1&return_source=project-artifacts',
    );
  });

  it('reads project artifact browser state from supported search params', () => {
    const searchParams = new URLSearchParams(
      'q=release&workflow_id=workflow-1&work_item_id=wi-1&task_id=task-2&stage_name=review&role=writer&content_type=text%2Fmarkdown&preview_mode=inline&created_from=2026-03-01&created_to=2026-03-02&sort=largest&page=3&artifact_id=artifact-9',
    );

    expect(readProjectArtifactRouteState(searchParams)).toEqual({
      query: 'release',
      workflowId: 'workflow-1',
      workItemId: 'wi-1',
      taskId: 'task-2',
      stageName: 'review',
      role: 'writer',
      contentType: 'text/markdown',
      previewMode: 'inline',
      createdFrom: '2026-03-01',
      createdTo: '2026-03-02',
      sort: 'largest',
      page: 3,
      artifactId: 'artifact-9',
    });
  });

  it('accepts legacy workflow and work-item query aliases for existing deep links', () => {
    const searchParams = new URLSearchParams('workflow=workflow-1&work_item=wi-1');
    expect(readProjectArtifactRouteState(searchParams)).toMatchObject({
      workflowId: 'workflow-1',
      workItemId: 'wi-1',
    });
  });

  it('falls back to safe defaults when route state is absent or invalid', () => {
    const searchParams = new URLSearchParams('preview_mode=broken&sort=bad&page=0');
    expect(readProjectArtifactRouteState(searchParams)).toEqual(
      DEFAULT_PROJECT_ARTIFACT_ROUTE_STATE,
    );
  });

  it('builds project artifact browser links with canonical filter names', () => {
    expect(
      buildProjectArtifactBrowserPath('project-1', {
        workflowId: 'workflow-1',
        workItemId: 'wi-1',
        previewMode: 'inline',
        artifactId: 'artifact-2',
      }),
    ).toBe(
      '/projects/project-1/artifacts?workflow_id=workflow-1&work_item_id=wi-1&preview_mode=inline&artifact_id=artifact-2',
    );
  });

  it('reads preview return context from query params', () => {
    const searchParams = new URLSearchParams(
      'return_to=%2Fprojects%2Fproject-1%2Fartifacts%3Fworkflow_id%3Dworkflow-1&return_source=project-artifacts',
    );
    expect(readArtifactPreviewReturnState(searchParams)).toEqual({
      returnTo: '/projects/project-1/artifacts?workflow_id=workflow-1',
      returnSource: 'project-artifacts',
    });
  });
});
