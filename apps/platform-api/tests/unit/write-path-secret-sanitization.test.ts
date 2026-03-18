import { describe, expect, it, vi } from 'vitest';

import { WorkspaceService } from '../../src/services/workspace-service.js';
import { ArtifactService } from '../../src/services/artifact-service.js';

function createIdentity() {
  return {
    tenantId: 'tenant-1',
    scope: 'admin',
    ownerType: 'tenant',
    ownerId: 'tenant-1',
    keyPrefix: 'admin-key',
    id: 'key-1',
  };
}

function createEventService() {
  return { emit: vi.fn(async () => undefined) };
}

describe('Workspace memory write-path secret sanitization', () => {
  it('strips raw secret values from memory on createWorkspace before DB persistence', async () => {
    let persistedMemory: Record<string, unknown> | null = null;
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.startsWith('INSERT INTO workspaces')) {
          persistedMemory = (values?.[6] as Record<string, unknown>) ?? null;
          return {
            rowCount: 1,
            rows: [{
              id: 'workspace-1',
              tenant_id: 'tenant-1',
              name: 'Demo',
              slug: 'demo',
              description: null,
              repository_url: null,
              settings: {},
              memory: persistedMemory,
              git_webhook_secret: null,
              is_active: true,
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const service = new WorkspaceService(pool as never, createEventService() as never);

    await service.createWorkspace(createIdentity() as never, {
      name: 'Demo',
      slug: 'demo',
      memory: {
        safe_label: 'demo workspace',
        leaked_key: 'sk-live-abc123secret',
        nested: {
          authorization: 'Bearer top-secret-token',
          jwt_session: 'eyJhbGciOiJIUzI1NiJ9.payload.signature',
          safe_note: 'this is fine',
        },
        secret_ref: 'secret:MY_API_KEY',
      },
    });

    expect(persistedMemory).not.toBeNull();
    expect(persistedMemory!.safe_label).toBe('demo workspace');
    expect(persistedMemory!.leaked_key).toMatch(/^redacted:\/\//);
    expect(persistedMemory!.secret_ref).toBe('secret:MY_API_KEY');
    const nested = persistedMemory!.nested as Record<string, unknown>;
    expect(nested.authorization).toMatch(/^redacted:\/\//);
    expect(nested.jwt_session).toMatch(/^redacted:\/\//);
    expect(nested.safe_note).toBe('this is fine');
  });

  it('strips raw secret values from patch value before DB persistence in patchWorkspaceMemoryEntries', async () => {
    let persistedMemory: Record<string, unknown> | null = null;
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workspace-1',
              tenant_id: 'tenant-1',
              name: 'Demo',
              slug: 'demo',
              memory: {},
              memory_max_bytes: 1_048_576,
              git_webhook_secret: null,
              is_active: true,
            }],
          };
        }
        if (sql.startsWith('UPDATE workspaces')) {
          persistedMemory = (values?.[2] as Record<string, unknown>) ?? null;
          return {
            rowCount: 1,
            rows: [{
              id: 'workspace-1',
              tenant_id: 'tenant-1',
              name: 'Demo',
              slug: 'demo',
              memory: persistedMemory,
              git_webhook_secret: null,
              is_active: true,
            }],
          };
        }
        if (sql.startsWith('INSERT INTO events')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    const pool = { connect: vi.fn(async () => client) };
    const service = new WorkspaceService(pool as never, createEventService() as never);

    await service.patchWorkspaceMemory(createIdentity() as never, 'workspace-1', {
      key: 'config',
      value: {
        api_token: 'Bearer leaked-runtime-token',
        safe_url: 'https://example.com',
        ref: 'secret:DEPLOY_TOKEN',
      },
    });

    expect(persistedMemory).not.toBeNull();
    const config = persistedMemory!.config as Record<string, unknown>;
    expect(config.api_token).toMatch(/^redacted:\/\//);
    expect(config.safe_url).toBe('https://example.com');
    expect(config.ref).toBe('secret:DEPLOY_TOKEN');
  });
});

describe('Artifact metadata write-path secret sanitization', () => {
  it('strips raw secret values from metadata before DB persistence on upload', async () => {
    let persistedMetadata: Record<string, unknown> | null = null;
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes('expires_at <')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM tasks')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-1',
              tenant_id: 'tenant-1',
              workflow_id: 'wf-1',
              workspace_id: 'proj-1',
              workflow_metadata: null,
            }],
          };
        }
        if (sql.startsWith('INSERT INTO workflow_artifacts')) {
          persistedMetadata = (values?.[11] as Record<string, unknown>) ?? null;
          return {
            rowCount: 1,
            rows: [{
              id: 'artifact-1',
              tenant_id: 'tenant-1',
              workflow_id: 'wf-1',
              workspace_id: 'proj-1',
              task_id: 'task-1',
              logical_path: 'artifact:wf-1/report.md',
              storage_backend: 'local',
              storage_key: 'tenant-1/wf-1/artifact-1/report.md',
              content_type: 'text/markdown',
              size_bytes: 256,
              checksum_sha256: 'abc123',
              metadata: persistedMetadata,
              retention_policy: { mode: 'ephemeral' },
              expires_at: null,
              created_at: new Date('2026-03-12T10:00:00.000Z'),
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const storage = {
      putObject: vi.fn(async () => ({
        backend: 'local',
        storageKey: 'tenant-1/wf-1/artifact-1/report.md',
        contentType: 'text/markdown',
        sizeBytes: 256,
        checksumSha256: 'abc123',
      })),
      getObject: vi.fn(),
      deleteObject: vi.fn(),
      exists: vi.fn(),
      list: vi.fn(),
      createAccessUrl: vi.fn(),
    };
    const service = new ArtifactService(pool as never, storage as never, 900);

    await service.uploadTaskArtifact(createIdentity() as never, 'task-1', {
      path: 'report.md',
      contentBase64: Buffer.from('# hello').toString('base64'),
      metadata: {
        source: 'agent',
        leaked_token: 'sk-live-secret-value',
        nested: {
          authorization: 'Bearer internal-secret',
          safe_note: 'analysis complete',
        },
      },
    });

    expect(persistedMetadata).not.toBeNull();
    expect(persistedMetadata!.source).toBe('agent');
    expect(persistedMetadata!.leaked_token).toMatch(/^redacted:\/\//);
    const nested = persistedMetadata!.nested as Record<string, unknown>;
    expect(nested.authorization).toMatch(/^redacted:\/\//);
    expect(nested.safe_note).toBe('analysis complete');
  });
});
