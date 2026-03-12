import { describe, expect, it, vi } from 'vitest';

import {
  createWorkflowDocument,
  deleteWorkflowDocument,
  listWorkflowDocuments,
  updateWorkflowDocument,
} from '../../src/services/document-reference-service.js';

describe('document reference service', () => {
  it('redacts plaintext secrets from workflow and project document metadata', async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('SELECT project_id, project_spec_version')) {
          return {
            rowCount: 1,
            rows: [{ project_id: 'project-1', project_spec_version: 2 }],
          };
        }
        if (sql.includes('FROM project_spec_versions')) {
          return {
            rowCount: 1,
            rows: [{
              spec: {
                documents: {
                  plan: {
                    source: 'repository',
                    path: 'docs/plan.md',
                    metadata: {
                      deploy_token: 'plaintext-project-secret',
                      secret_ref: 'secret:PROJECT_DOC_TOKEN',
                    },
                  },
                },
              },
            }],
          };
        }
        if (sql.includes('FROM workflow_documents')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'doc-1',
                logical_name: 'report',
                source: 'repository',
                location: 'reports/final.md',
                artifact_id: null,
                content_type: null,
                title: 'Report',
                description: null,
                metadata: {
                  api_key: 'sk-workflow-secret',
                  repository: 'origin',
                  secret_ref: 'secret:WORKFLOW_DOC_TOKEN',
                },
                task_id: null,
                created_at: new Date('2026-03-11T00:00:00Z'),
              },
            ],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const documents = await listWorkflowDocuments(db as never, 'tenant-1', 'workflow-1');

    expect(documents).toEqual([
      expect.objectContaining({
        logical_name: 'plan',
        metadata: {
          deploy_token: 'redacted://document-secret',
          secret_ref: 'secret:PROJECT_DOC_TOKEN',
        },
      }),
      expect.objectContaining({
        logical_name: 'report',
        metadata: {
          api_key: 'redacted://document-secret',
          repository: 'origin',
          secret_ref: 'secret:WORKFLOW_DOC_TOKEN',
        },
      }),
    ]);
  });

  it('creates artifact-backed workflow documents from existing workflow artifacts', async () => {
    const db = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        if (sql.includes('SELECT project_id, project_spec_version')) {
          return {
            rowCount: 1,
            rows: [{ project_id: 'project-1', project_spec_version: 2 }],
          };
        }
        if (sql.includes('FROM workflow_documents') && sql.includes('ORDER BY created_at DESC')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_artifacts')) {
          expect(params[2]).toBe('task-1');
          return {
            rowCount: 1,
            rows: [{
              id: 'artifact-1',
              task_id: 'task-1',
              logical_path: 'docs/spec.md',
              content_type: 'text/markdown',
            }],
          };
        }
        if (sql.includes('INSERT INTO workflow_documents')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'doc-1',
              logical_name: 'spec',
              source: 'artifact',
              location: 'docs/spec.md',
              artifact_id: 'artifact-1',
              content_type: 'text/markdown',
              title: 'Spec',
              description: null,
              metadata: {},
              task_id: 'task-1',
              created_at: new Date('2026-03-12T00:00:00Z'),
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const document = await createWorkflowDocument(db as never, 'tenant-1', 'workflow-1', {
      logical_name: 'spec',
      source: 'artifact',
      task_id: 'task-1',
      logical_path: 'docs/spec.md',
      title: 'Spec',
    });

    expect(document).toEqual({
      logical_name: 'spec',
      scope: 'workflow',
      source: 'artifact',
      title: 'Spec',
      metadata: {},
      created_at: '2026-03-12T00:00:00.000Z',
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

  it('updates workflow documents while preserving repository metadata', async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('SELECT project_id, project_spec_version')) {
          return {
            rowCount: 1,
            rows: [{ project_id: 'project-1', project_spec_version: 2 }],
          };
        }
        if (sql.includes('FROM workflow_documents') && sql.includes('ORDER BY created_at DESC')) {
          return {
            rowCount: 1,
            rows: [{
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
            }],
          };
        }
        if (sql.includes('UPDATE workflow_documents')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'doc-1',
              logical_name: 'plan',
              source: 'repository',
              location: 'docs/updated-plan.md',
              artifact_id: null,
              content_type: null,
              title: 'Updated Plan',
              description: 'Initial',
              metadata: { repository: 'origin' },
              task_id: null,
              created_at: new Date('2026-03-10T00:00:00Z'),
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const document = await updateWorkflowDocument(db as never, 'tenant-1', 'workflow-1', 'plan', {
      path: 'docs/updated-plan.md',
      title: 'Updated Plan',
    });

    expect(document).toEqual({
      logical_name: 'plan',
      scope: 'workflow',
      source: 'repository',
      title: 'Updated Plan',
      description: 'Initial',
      metadata: { repository: 'origin' },
      created_at: '2026-03-10T00:00:00.000Z',
      path: 'docs/updated-plan.md',
      repository: 'origin',
    });
  });

  it('deletes workflow documents by logical name', async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('DELETE FROM workflow_documents')) {
          return { rowCount: 1, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    await expect(
      deleteWorkflowDocument(db as never, 'tenant-1', 'workflow-1', 'plan'),
    ).resolves.toBeUndefined();
  });
});
