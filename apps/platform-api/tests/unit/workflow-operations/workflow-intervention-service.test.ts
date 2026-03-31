import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ValidationError } from '../../../src/errors/domain-errors.js';
import { WorkflowInterventionService } from '../../../src/services/workflow-operations/workflow-intervention-service.js';

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

describe('WorkflowInterventionService', () => {
  let pool: ReturnType<typeof createPool>;
  let storage: ReturnType<typeof createStorage>;
  let service: WorkflowInterventionService;

  beforeEach(() => {
    pool = createPool();
    storage = createStorage();
    service = new WorkflowInterventionService(pool as never, storage as never, 5, 1024 * 1024);
  });

  it('records workflow interventions with optional file attachments and structured actions', async () => {
    storage.putObject.mockResolvedValue({
      backend: 'local',
      storageKey: 'stored/intervention-file',
      contentType: 'text/plain',
      sizeBytes: 12,
      checksumSha256: 'checksum-1',
    });

    pool.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM workflows') && sql.includes('SELECT id')) {
        return {
          rowCount: 1,
          rows: [{ id: 'workflow-1' }],
        };
      }
      if (sql.includes('FROM workflow_work_items')) {
        return {
          rowCount: 1,
          rows: [{ id: 'work-item-1' }],
        };
      }
      if (sql.includes('FROM tasks')) {
        return {
          rowCount: 1,
          rows: [{ id: 'task-1' }],
        };
      }
      if (sql.includes('INSERT INTO workflow_interventions')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'intervention-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            task_id: 'task-1',
            request_id: 'request-1',
            kind: 'task_action',
            origin: 'operator',
            status: 'applied',
            outcome: 'applied',
            result_kind: 'task_retry_requested',
            snapshot_version: 'snapshot-1',
            settings_revision: 4,
            summary: 'Retry the verification task with the attached checklist',
            message: 'Retry requested.',
            note: 'Use the updated checklist first.',
            structured_action: { kind: 'retry_task', task_id: 'task-1' },
            metadata: { source: 'mission_control' },
            created_by_type: 'user',
            created_by_id: 'user-1',
            created_at: new Date('2026-03-27T10:00:00.000Z'),
            updated_at: new Date('2026-03-27T10:00:00.000Z'),
          }],
        };
      }
      if (sql.includes('INSERT INTO workflow_intervention_files')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'intervention-file-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            intervention_id: 'intervention-1',
            file_name: 'checklist.txt',
            description: 'Recovery checklist',
            storage_backend: 'local',
            storage_key: 'stored/intervention-file',
            content_type: 'text/plain',
            size_bytes: 12,
            checksum_sha256: 'checksum-1',
            created_at: new Date('2026-03-27T10:00:00.000Z'),
          }],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await service.recordIntervention(IDENTITY as never, 'workflow-1', {
      requestId: 'request-1',
      kind: 'task_action',
      summary: 'Retry the verification task with the attached checklist',
      outcome: 'applied',
      resultKind: 'task_retry_requested',
      snapshotVersion: 'snapshot-1',
      settingsRevision: 4,
      message: 'Retry requested.',
      note: 'Use the updated checklist first.',
      status: 'applied',
      structuredAction: { kind: 'retry_task', task_id: 'task-1' },
      metadata: { source: 'mission_control' },
      workItemId: 'work-item-1',
      taskId: 'task-1',
      files: [
        {
          fileName: 'checklist.txt',
          description: 'Recovery checklist',
          contentBase64: Buffer.from('checklist').toString('base64'),
          contentType: 'text/plain',
        },
      ],
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: 'intervention-1',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        task_id: 'task-1',
        request_id: 'request-1',
        kind: 'task_action',
        outcome: 'applied',
        result_kind: 'task_retry_requested',
        snapshot_version: 'snapshot-1',
        settings_revision: 4,
        message: 'Retry requested.',
        created_by_id: 'user-1',
        files: [
          expect.objectContaining({
            id: 'intervention-file-1',
            file_name: 'checklist.txt',
            download_url:
              '/api/v1/workflows/workflow-1/interventions/intervention-1/files/intervention-file-1/content',
          }),
        ],
      }),
    );
  });

  it('rejects interventions that reference a task outside the selected workflow', async () => {
    pool.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM workflows') && sql.includes('SELECT id')) {
        return {
          rowCount: 1,
          rows: [{ id: 'workflow-1' }],
        };
      }
      if (sql.includes('FROM tasks')) {
        return { rowCount: 0, rows: [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(
      service.recordIntervention(IDENTITY as never, 'workflow-1', {
        kind: 'task_action',
        summary: 'Retry this task',
        taskId: 'task-missing',
        files: [],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('fallsBackToKeyPrefixWhenPersistingSystemOwnedInterventionAuthorship', async () => {
    pool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM workflows') && sql.includes('SELECT id')) {
        return {
          rowCount: 1,
          rows: [{ id: 'workflow-1' }],
        };
      }
      if (sql.includes('INSERT INTO workflow_interventions')) {
        expect(params?.[19]).toBe('admin-system');
        return {
          rowCount: 1,
          rows: [{
            id: 'intervention-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: null,
            task_id: null,
            request_id: null,
            kind: 'workflow_action',
            origin: 'operator',
            status: 'applied',
            outcome: 'applied',
            result_kind: 'intervention_recorded',
            snapshot_version: null,
            settings_revision: null,
            summary: 'Pause workflow',
            message: null,
            note: null,
            structured_action: { kind: 'pause_workflow' },
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

    const result = await service.recordIntervention(SYSTEM_IDENTITY as never, 'workflow-1', {
      kind: 'workflow_action',
      summary: 'Pause workflow',
      structuredAction: { kind: 'pause_workflow' },
      files: [],
    });

    expect(result.created_by_type).toBe('system');
    expect(result.created_by_id).toBe('admin-system');
  });
});
