import { describe, expect, it } from 'vitest';

import {
  buildWorkflowDocumentReference,
  mergeWorkflowDocumentUpdate,
  normalizeDocumentDefinition,
} from '../../src/services/document-reference-service-support.js';
import type { WorkflowDocumentRow } from '../../src/services/document-reference-service.types.js';

function buildWorkflowDocumentRow(
  overrides: Partial<WorkflowDocumentRow> = {},
): WorkflowDocumentRow {
  return {
    id: 'doc-1',
    logical_name: 'plan',
    source: 'repository',
    location: 'docs/plan.md',
    artifact_id: null,
    content_type: null,
    title: 'Plan',
    description: 'Initial',
    metadata: { repository: 'origin' },
    task_id: null,
    created_at: new Date('2026-03-10T00:00:00Z'),
    ...overrides,
  };
}

describe('document reference service support', () => {
  it('normalizes repository document definitions', () => {
    expect(
      normalizeDocumentDefinition(
        'plan',
        {
          source: 'repository',
          path: 'docs/plan.md',
          repository: 'origin',
          metadata: { token: 'secret' },
        },
        'workflow_api',
      ),
    ).toEqual({
      source: 'repository',
      path: 'docs/plan.md',
      repository: 'origin',
      metadata: { token: 'secret' },
      title: undefined,
      description: undefined,
    });
  });

  it('builds artifact workflow references with a download URL', () => {
    expect(
      buildWorkflowDocumentReference(
        buildWorkflowDocumentRow({
          logical_name: 'spec',
          source: 'artifact',
          location: 'docs/spec.md',
          artifact_id: 'artifact-1',
          task_id: 'task-1',
          content_type: 'text/markdown',
          metadata: {},
        }),
      ),
    ).toEqual({
      logical_name: 'spec',
      scope: 'workflow',
      source: 'artifact',
      title: 'Plan',
      description: 'Initial',
      metadata: {},
      created_at: '2026-03-10T00:00:00.000Z',
      task_id: 'task-1',
      artifact: {
        id: 'artifact-1',
        task_id: 'task-1',
        logical_path: 'docs/spec.md',
        content_type: 'text/markdown',
        download_url: '/api/v1/tasks/task-1/artifacts/artifact-1',
      },
    });
  });

  it('preserves repository metadata across updates', () => {
    expect(
      mergeWorkflowDocumentUpdate(buildWorkflowDocumentRow(), {
        path: 'docs/updated-plan.md',
        title: 'Updated Plan',
      }),
    ).toEqual({
      source: 'repository',
      title: 'Updated Plan',
      description: 'Initial',
      metadata: { repository: 'origin' },
      repository: 'origin',
      path: 'docs/updated-plan.md',
      url: undefined,
      task_id: undefined,
      artifact_id: undefined,
      logical_path: undefined,
    });
  });
});
