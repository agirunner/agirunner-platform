import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ValidationError } from '../../src/errors/domain-errors.js';
import { WorkflowInputPacketService } from '../../src/services/workflow-input-packet-service.js';

const IDENTITY = {
  id: 'key-1',
  tenantId: 'tenant-1',
  scope: 'admin',
  ownerType: 'user',
  ownerId: 'user-1',
  keyPrefix: 'admin',
} as const;

const SYSTEM_IDENTITY = {
  id: 'key-system-1',
  tenantId: 'tenant-1',
  scope: 'admin',
  ownerType: 'system',
  ownerId: null,
  keyPrefix: 'admin-system',
} as const;

function createPool() {
  return {
    query: vi.fn(),
  };
}

function createStorage() {
  return {
    putObject: vi.fn(),
    getObject: vi.fn(),
    deleteObject: vi.fn(),
  };
}

describe('WorkflowInputPacketService', () => {
  let pool: ReturnType<typeof createPool>;
  let storage: ReturnType<typeof createStorage>;
  let service: WorkflowInputPacketService;

  beforeEach(() => {
    pool = createPool();
    storage = createStorage();
    service = new WorkflowInputPacketService(pool as never, storage as never, 5, 1024 * 1024);
  });

  it('stores workflow-scoped input packets with uploaded files and operator provenance', async () => {
    storage.putObject.mockResolvedValue({
      backend: 'local',
      storageKey: 'stored/packet-file',
      contentType: 'text/markdown',
      sizeBytes: 7,
      checksumSha256: 'checksum-1',
    });

    pool.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM workflows') && sql.includes('workspace_id')) {
        return {
          rowCount: 1,
          rows: [{ id: 'workflow-1', workspace_id: 'workspace-1' }],
        };
      }
      if (sql.includes('FROM workflow_work_items')) {
        return {
          rowCount: 1,
          rows: [{ id: 'work-item-1' }],
        };
      }
      if (sql.includes('INSERT INTO workflow_input_packets')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'packet-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            packet_kind: 'supplemental',
            source: 'operator',
            summary: 'Operator supplied additional design brief',
            structured_inputs: { branch: 'hotfix' },
            metadata: { channel: 'mission_control' },
            created_by_type: 'user',
            created_by_id: 'user-1',
            created_at: new Date('2026-03-27T10:00:00.000Z'),
            updated_at: new Date('2026-03-27T10:00:00.000Z'),
          }],
        };
      }
      if (sql.includes('INSERT INTO workflow_input_packet_files')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'packet-file-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            packet_id: 'packet-1',
            file_name: 'brief.md',
            description: 'Supplemental brief',
            storage_backend: 'local',
            storage_key: 'stored/packet-file',
            content_type: 'text/markdown',
            size_bytes: 7,
            checksum_sha256: 'checksum-1',
            created_at: new Date('2026-03-27T10:00:00.000Z'),
          }],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await service.createWorkflowInputPacket(IDENTITY as never, 'workflow-1', {
      packetKind: 'supplemental',
      summary: 'Operator supplied additional design brief',
      structuredInputs: { branch: 'hotfix' },
      metadata: { channel: 'mission_control' },
      workItemId: 'work-item-1',
      files: [
        {
          fileName: 'brief.md',
          description: 'Supplemental brief',
          contentBase64: Buffer.from('# Brief').toString('base64'),
          contentType: 'text/markdown',
        },
      ],
    });

    expect(storage.putObject).toHaveBeenCalledWith(
      expect.stringContaining('/workflows/workflow-1/input-packets/packet-1/files/'),
      expect.any(Buffer),
      'text/markdown',
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: 'packet-1',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        packet_kind: 'supplemental',
        source: 'operator',
        created_by_type: 'user',
        created_by_id: 'user-1',
        files: [
          expect.objectContaining({
            id: 'packet-file-1',
            file_name: 'brief.md',
            description: 'Supplemental brief',
            download_url: '/api/v1/workflows/workflow-1/input-packets/packet-1/files/packet-file-1/content',
          }),
        ],
      }),
    );
  });

  it('rejects packet creation when the selected work item does not belong to the workflow', async () => {
    pool.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM workflows') && sql.includes('workspace_id')) {
        return {
          rowCount: 1,
          rows: [{ id: 'workflow-1', workspace_id: 'workspace-1' }],
        };
      }
      if (sql.includes('FROM workflow_work_items')) {
        return { rowCount: 0, rows: [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(
      service.createWorkflowInputPacket(IDENTITY as never, 'workflow-1', {
        packetKind: 'supplemental',
        workItemId: 'work-item-missing',
        files: [],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('fallsBackToKeyPrefixWhenPersistingSystemOwnedPacketAuthorship', async () => {
    pool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM workflows') && sql.includes('workspace_id')) {
        return {
          rowCount: 1,
          rows: [{ id: 'workflow-1', workspace_id: 'workspace-1' }],
        };
      }
      if (sql.includes('INSERT INTO workflow_input_packets')) {
        expect(params?.[10]).toBe('admin-system');
        return {
          rowCount: 1,
          rows: [{
            id: 'packet-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: null,
            packet_kind: 'launch',
            source: 'operator',
            summary: null,
            structured_inputs: {},
            metadata: {},
            created_by_type: 'system',
            created_by_id: 'admin-system',
            created_at: new Date('2026-03-27T10:00:00.000Z'),
            updated_at: new Date('2026-03-27T10:00:00.000Z'),
          }],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await service.createWorkflowInputPacket(SYSTEM_IDENTITY as never, 'workflow-1', {
      packetKind: 'launch',
      files: [],
    });

    expect(result.created_by_type).toBe('system');
    expect(result.created_by_id).toBe('admin-system');
  });
});
