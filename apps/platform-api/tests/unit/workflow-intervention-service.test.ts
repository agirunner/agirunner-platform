import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ValidationError } from '../../src/errors/domain-errors.js';
import { WorkflowInterventionService } from '../../src/services/workflow-intervention-service.js';

const IDENTITY = {
  id: 'key-1',
  tenantId: 'tenant-1',
  scope: 'admin',
  ownerType: 'user',
  ownerId: 'user-1',
  keyPrefix: 'admin',
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
            kind: 'task_action',
            origin: 'operator',
            status: 'applied',
            summary: 'Retry the verification task with the attached checklist',
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
      kind: 'task_action',
      summary: 'Retry the verification task with the attached checklist',
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
        kind: 'task_action',
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
});
