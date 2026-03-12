import { describe, expect, it, vi } from 'vitest';

import { ArtifactService } from '../../src/services/artifact-service.js';

function createStorage() {
  return {
    backend: 'local' as const,
    putObject: vi.fn(),
    getObject: vi.fn().mockResolvedValue({
      contentType: 'text/markdown',
      data: Buffer.from('# hello'),
    }),
    deleteObject: vi.fn(),
    exists: vi.fn(),
    list: vi.fn(),
    createAccessUrl: vi.fn().mockResolvedValue({
      url: 'https://storage.example/artifact',
      expiresAt: new Date('2026-03-12T12:00:00.000Z'),
    }),
  };
}

describe('ArtifactService', () => {
  it('adds preview and permalink metadata for inline-safe artifacts', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 0,
          rows: [],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              id: 'task-1',
              tenant_id: 'tenant-1',
              workflow_id: 'wf-1',
              project_id: 'proj-1',
              workflow_metadata: null,
            },
          ],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              id: 'artifact-1',
              tenant_id: 'tenant-1',
              workflow_id: 'wf-1',
              project_id: 'proj-1',
              task_id: 'task-1',
              logical_path: 'artifact:wf-1/report.md',
              storage_backend: 'local',
              storage_key: 'tenant-1/wf-1/artifact-1/report.md',
              content_type: 'text/markdown; charset=utf-8',
              size_bytes: 256,
              checksum_sha256: 'abc123',
              metadata: { source: 'agent', api_key: 'plain-secret', token_ref: 'secret:ARTIFACT_TOKEN' },
              retention_policy: { mode: 'ephemeral' },
              expires_at: null,
              created_at: new Date('2026-03-12T10:00:00.000Z'),
            },
          ],
        }),
    };
    const storage = createStorage();
    const service = new ArtifactService(pool as never, storage as never, 900, 1024);

    const artifacts = await service.listTaskArtifacts('tenant-1', 'task-1');

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      preview_eligible: true,
      preview_mode: 'text',
      preview_url: '/api/v1/tasks/task-1/artifacts/artifact-1/preview',
      permalink_url: '/api/v1/tasks/task-1/artifacts/artifact-1/permalink',
      download_url: '/api/v1/tasks/task-1/artifacts/artifact-1',
    });
    expect(artifacts[0]?.metadata).toEqual({
      source: 'agent',
      api_key: 'redacted://artifact-metadata-secret',
      token_ref: 'secret:ARTIFACT_TOKEN',
    });
    expect(artifacts[0]).not.toHaveProperty('access_url');
    expect(artifacts[0]).not.toHaveProperty('access_url_expires_at');
    expect(storage.createAccessUrl).not.toHaveBeenCalled();
  });

  it('rejects inline preview for unsupported artifact types', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rowCount: 1,
        rows: [
          {
            id: 'artifact-1',
            tenant_id: 'tenant-1',
            workflow_id: 'wf-1',
            project_id: 'proj-1',
            task_id: 'task-1',
            logical_path: 'artifact:wf-1/index.html',
            storage_backend: 'local',
            storage_key: 'tenant-1/wf-1/artifact-1/index.html',
            content_type: 'text/html',
            size_bytes: 256,
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
    const service = new ArtifactService(pool as never, storage as never, 900, 1024);

    await expect(service.previewTaskArtifact('tenant-1', 'task-1', 'artifact-1')).rejects.toThrow(
      'Artifact is not eligible for inline preview',
    );
    expect(storage.getObject).not.toHaveBeenCalled();
  });

  it('keeps preview responses on platform urls without object-store shortcuts', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rowCount: 1,
        rows: [
          {
            id: 'artifact-1',
            tenant_id: 'tenant-1',
            workflow_id: 'wf-1',
            project_id: 'proj-1',
            task_id: 'task-1',
            logical_path: 'artifact:wf-1/report.md',
            storage_backend: 'local',
            storage_key: 'tenant-1/wf-1/artifact-1/report.md',
            content_type: 'text/markdown; charset=utf-8',
            size_bytes: 256,
            checksum_sha256: 'abc123',
            metadata: { credentials: { password: 'plain-secret', secret_ref: 'secret:ARTIFACT_PASSWORD' } },
            retention_policy: {},
            expires_at: null,
            created_at: new Date('2026-03-12T10:00:00.000Z'),
          },
        ],
      }),
    };
    const storage = createStorage();
    const service = new ArtifactService(pool as never, storage as never, 900, 1024);

    const preview = await service.previewTaskArtifact('tenant-1', 'task-1', 'artifact-1');

    expect(preview.artifact.download_url).toBe('/api/v1/tasks/task-1/artifacts/artifact-1');
    expect(preview.artifact.preview_url).toBe('/api/v1/tasks/task-1/artifacts/artifact-1/preview');
    expect(preview.artifact.permalink_url).toBe('/api/v1/tasks/task-1/artifacts/artifact-1/permalink');
    expect(preview.artifact.metadata).toEqual({
      credentials: {
        password: 'redacted://artifact-metadata-secret',
        secret_ref: 'secret:ARTIFACT_PASSWORD',
      },
    });
    expect(preview.artifact).not.toHaveProperty('access_url');
    expect(preview.artifact).not.toHaveProperty('access_url_expires_at');
    expect(storage.createAccessUrl).not.toHaveBeenCalled();
  });
});
