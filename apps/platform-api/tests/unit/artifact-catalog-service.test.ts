import { describe, expect, it, vi } from 'vitest';

import { ArtifactCatalogService } from '../../src/services/artifact-catalog-service.js';

function createStorage() {
  return {
    backend: 'local' as const,
    putObject: vi.fn(),
    getObject: vi.fn().mockResolvedValue({
      contentType: 'application/pdf',
      data: Buffer.from('pdf'),
    }),
    deleteObject: vi.fn(),
    exists: vi.fn(),
    list: vi.fn(),
    createAccessUrl: vi.fn().mockResolvedValue({
      url: 'https://storage.example/catalog-artifact',
      expiresAt: new Date('2026-03-12T12:00:00.000Z'),
    }),
  };
}

describe('ArtifactCatalogService', () => {
  it('adds preview metadata for workflow-scoped artifact catalog entries', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: 'task-1', workflow_id: 'wf-1', project_id: 'proj-1' }],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              id: 'artifact-1',
              workflow_id: 'wf-1',
              project_id: 'proj-1',
              task_id: 'task-2',
              work_item_id: 'work-item-1',
              logical_path: 'artifact:wf-1/spec.pdf',
              storage_backend: 'local',
              storage_key: 'tenant-1/wf-1/artifact-1/spec.pdf',
              content_type: 'application/pdf',
              size_bytes: 1024,
              checksum_sha256: 'abc123',
              metadata: { api_key: 'plain-secret', token_ref: 'secret:CATALOG_TOKEN' },
              retention_policy: {},
              expires_at: null,
              created_at: new Date('2026-03-12T10:00:00.000Z'),
            },
          ],
        }),
    };
    const storage = createStorage();
    const service = new ArtifactCatalogService(pool as never, storage as never, 900, 2048);

    const artifacts = await service.listArtifactsForTaskScope('tenant-1', 'task-1', {});

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      work_item_id: 'work-item-1',
      preview_eligible: true,
      preview_mode: 'pdf',
      preview_url: '/api/v1/tasks/task-2/artifact-catalog/artifact-1/preview',
      permalink_url: '/api/v1/tasks/task-2/artifact-catalog/artifact-1/permalink',
    });
    expect(artifacts[0]?.metadata).toEqual({
      api_key: 'redacted://artifact-metadata-secret',
      token_ref: 'secret:CATALOG_TOKEN',
    });
    expect(artifacts[0]).not.toHaveProperty('access_url');
    expect(artifacts[0]).not.toHaveProperty('access_url_expires_at');
    expect(storage.createAccessUrl).not.toHaveBeenCalled();
  });

  it('rejects inline preview for oversized artifacts', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: 'task-1', workflow_id: 'wf-1', project_id: 'proj-1' }],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              id: 'artifact-1',
              workflow_id: 'wf-1',
              project_id: 'proj-1',
              task_id: 'task-2',
              work_item_id: 'work-item-1',
              logical_path: 'artifact:wf-1/spec.pdf',
              storage_backend: 'local',
              storage_key: 'tenant-1/wf-1/artifact-1/spec.pdf',
              content_type: 'application/pdf',
              size_bytes: 4096,
              checksum_sha256: 'abc123',
              metadata: {},
              retention_policy: {},
              expires_at: null,
              created_at: new Date('2026-03-12T10:00:00.000Z'),
            },
          ],
        }),
    };
    const storage = createStorage();
    const service = new ArtifactCatalogService(pool as never, storage as never, 900, 2048);

    await expect(
      service.previewArtifactForTaskScope('tenant-1', 'task-1', 'artifact-1'),
    ).rejects.toThrow('Artifact is not eligible for inline preview');
    expect(storage.getObject).not.toHaveBeenCalled();
  });

  it('keeps catalog preview responses on platform urls without object-store shortcuts', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: 'task-1', workflow_id: 'wf-1', project_id: 'proj-1' }],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              id: 'artifact-1',
              workflow_id: 'wf-1',
              project_id: 'proj-1',
              task_id: 'task-2',
              work_item_id: 'work-item-1',
              logical_path: 'artifact:wf-1/spec.pdf',
              storage_backend: 'local',
              storage_key: 'tenant-1/wf-1/artifact-1/spec.pdf',
              content_type: 'application/pdf',
              size_bytes: 1024,
              checksum_sha256: 'abc123',
              metadata: { credentials: { password: 'plain-secret', secret_ref: 'secret:CATALOG_PASSWORD' } },
              retention_policy: {},
              expires_at: null,
              created_at: new Date('2026-03-12T10:00:00.000Z'),
            },
          ],
        }),
    };
    const storage = createStorage();
    const service = new ArtifactCatalogService(pool as never, storage as never, 900, 2048);

    const preview = await service.previewArtifactForTaskScope('tenant-1', 'task-1', 'artifact-1');

    expect(preview.artifact.download_url).toBe('/api/v1/tasks/task-2/artifact-catalog/artifact-1');
    expect(preview.artifact.preview_url).toBe('/api/v1/tasks/task-2/artifact-catalog/artifact-1/preview');
    expect(preview.artifact.permalink_url).toBe('/api/v1/tasks/task-2/artifact-catalog/artifact-1/permalink');
    expect(preview.artifact.metadata).toEqual({
      credentials: {
        password: 'redacted://artifact-metadata-secret',
        secret_ref: 'secret:CATALOG_PASSWORD',
      },
    });
    expect(preview.artifact).not.toHaveProperty('access_url');
    expect(preview.artifact).not.toHaveProperty('access_url_expires_at');
    expect(storage.createAccessUrl).not.toHaveBeenCalled();
  });
});
