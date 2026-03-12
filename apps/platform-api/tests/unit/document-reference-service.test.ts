import { describe, expect, it, vi } from 'vitest';

import { listWorkflowDocuments } from '../../src/services/document-reference-service.js';

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
});
