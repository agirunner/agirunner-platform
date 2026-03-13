import { describe, expect, it } from 'vitest';

import {
  buildWorkflowDocumentCreatePayload,
  buildWorkflowDocumentUpdatePayload,
  createWorkflowDocumentDraft,
  validateWorkflowDocumentDraft,
} from './workflow-detail-document-support.js';

describe('workflow detail document support', () => {
  it('validates source-specific workflow document requirements', () => {
    expect(
      validateWorkflowDocumentDraft({
        logicalName: '   ',
        source: 'repository',
        title: '',
        description: '',
        repository: 'repo',
        path: '',
        url: '',
        taskId: '',
        artifactId: '',
        logicalPath: '',
      }),
    ).toEqual({
      fieldErrors: {
        logicalName: 'Logical name is required.',
        path: 'Repository path is required.',
      },
      issueCount: 2,
      isValid: false,
      summary: '2 fields need attention before this reference can be saved.',
    });

    expect(
      validateWorkflowDocumentDraft(
        {
          logicalName: 'brief',
          source: 'external',
          title: '',
          description: '',
          repository: '',
          path: '',
          url: 'not-a-url',
          taskId: '',
          artifactId: '',
          logicalPath: '',
        },
        'Metadata keys cannot be empty.',
      ),
    ).toEqual({
      fieldErrors: {
        metadata: 'Metadata keys cannot be empty.',
        url: 'External URL must be valid.',
      },
      issueCount: 2,
      isValid: false,
      summary: '2 fields need attention before this reference can be saved.',
    });
  });

  it('requires a task and artifact reference for artifact-backed documents', () => {
    expect(
      validateWorkflowDocumentDraft({
        logicalName: 'spec',
        source: 'artifact',
        title: '',
        description: '',
        repository: '',
        path: '',
        url: '',
        taskId: '',
        artifactId: '',
        logicalPath: '',
      }),
    ).toEqual({
      fieldErrors: {
        artifactReference:
          'Select an artifact or enter its logical path for artifact-backed documents.',
        taskId: 'Artifact-backed documents must select a workflow task.',
      },
      issueCount: 2,
      isValid: false,
      summary: '2 fields need attention before this reference can be saved.',
    });
  });

  it('builds create and update payloads while clearing stale source fields', () => {
    expect(
      buildWorkflowDocumentCreatePayload(
        {
          logicalName: 'project_brief',
          source: 'artifact',
          title: 'Brief',
          description: 'Operator handoff',
          repository: '',
          path: '',
          url: '',
          taskId: 'task-1',
          artifactId: 'artifact-1',
          logicalPath: 'artifact:task-1/brief.md',
        },
        { owner: 'ops' },
      ),
    ).toEqual({
      logical_name: 'project_brief',
      source: 'artifact',
      title: 'Brief',
      description: 'Operator handoff',
      metadata: { owner: 'ops' },
      task_id: 'task-1',
      artifact_id: 'artifact-1',
      logical_path: 'artifact:task-1/brief.md',
    });

    expect(
      buildWorkflowDocumentUpdatePayload(
        {
          logicalName: 'project_brief',
          source: 'external',
          title: '',
          description: 'Published brief',
          repository: 'org/repo',
          path: 'docs/brief.md',
          url: 'https://example.com/brief',
          taskId: 'task-1',
          artifactId: 'artifact-1',
          logicalPath: 'artifact:task-1/brief.md',
        },
        {},
      ),
    ).toEqual({
      source: 'external',
      title: null,
      description: 'Published brief',
      metadata: {},
      repository: null,
      path: null,
      url: 'https://example.com/brief',
      task_id: null,
      artifact_id: null,
      logical_path: null,
    });
  });

  it('hydrates edit drafts from resolved workflow documents', () => {
    expect(
      createWorkflowDocumentDraft({
        logical_name: 'design_brief',
        scope: 'workflow',
        source: 'artifact',
        title: 'Design Brief',
        description: 'Latest artifact packet',
        metadata: {},
        task_id: 'task-9',
        artifact: {
          id: 'artifact-9',
          task_id: 'task-9',
          logical_path: 'artifact:task-9/design.md',
          download_url: '/api/v1/tasks/task-9/artifacts/artifact-9',
        },
      }),
    ).toEqual({
      logicalName: 'design_brief',
      source: 'artifact',
      title: 'Design Brief',
      description: 'Latest artifact packet',
      repository: '',
      path: '',
      url: '',
      taskId: 'task-9',
      artifactId: 'artifact-9',
      logicalPath: 'artifact:task-9/design.md',
    });
  });
});
