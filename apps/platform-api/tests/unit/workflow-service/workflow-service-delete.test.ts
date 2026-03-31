import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkflowService } from '../../../src/services/workflow-service.js';

describe('WorkflowService deleteWorkflow', () => {
  const artifactLocalRoot = resolve('tmp');

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deletes stored workflow files before deleting a terminal workflow', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ state: 'completed' }], rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [
            { storage_key: 'tenants/tenant-1/workflows/workflow-1/input-packets/packet-1/files/file-1/spec.md' },
            { storage_key: 'tenants/tenant-1/workflows/workflow-1/interventions/intervention-1/files/file-2/note.txt' },
            { storage_key: 'tenants/tenant-1/workflows/workflow-1/input-packets/packet-1/files/file-1/spec.md' },
          ],
          rowCount: 3,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn(async () => client),
    };
    const eventService = {
      emit: vi.fn(async () => undefined),
    };
    const artifactStorage = {
      deleteObject: vi.fn(async () => undefined),
    };
    const service = new WorkflowService(
      pool as never,
      eventService as never,
      { TASK_DEFAULT_TIMEOUT_MINUTES: 30, ARTIFACT_STORAGE_BACKEND: 'local', ARTIFACT_LOCAL_ROOT: artifactLocalRoot } as never,
    );
    (service as unknown as { artifactStorage: typeof artifactStorage }).artifactStorage = artifactStorage;

    const result = await service.deleteWorkflow(
      {
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        keyPrefix: 'key-prefix',
      } as never,
      'workflow-1',
    );

    expect(result).toEqual({ id: 'workflow-1', deleted: true });
    expect(artifactStorage.deleteObject).toHaveBeenCalledTimes(2);
    expect(artifactStorage.deleteObject).toHaveBeenCalledWith(
      'tenants/tenant-1/workflows/workflow-1/input-packets/packet-1/files/file-1/spec.md',
    );
    expect(artifactStorage.deleteObject).toHaveBeenCalledWith(
      'tenants/tenant-1/workflows/workflow-1/interventions/intervention-1/files/file-2/note.txt',
    );
    expect(client.query).toHaveBeenNthCalledWith(3, expect.stringContaining('workflow_input_packet_files'), [
      'tenant-1',
      'workflow-1',
    ]);
    expect(client.query).toHaveBeenCalledWith('DELETE FROM workflows WHERE tenant_id = $1 AND id = $2', [
      'tenant-1',
      'workflow-1',
    ]);
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workflow.deleted',
        entityId: 'workflow-1',
      }),
      client,
    );
    expect(client.release).toHaveBeenCalled();
  });
});
