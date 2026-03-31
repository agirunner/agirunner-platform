import type { ApiKeyIdentity } from '../../auth/api-key.js';
import type { DatabaseClient, DatabasePool } from '../../db/database.js';
import { ValidationError } from '../../errors/domain-errors.js';
import type { EventService } from '../event-service.js';
import type { WorkspaceMemoryMutationContext } from '../workspace-memory-scope-service.js';
import {
  byteLengthJson,
  normalizeRecord,
  redactWorkspaceSecrets,
  sanitizeMemoryEventValue,
  sanitizeMemoryValueForPersistence,
} from './workspace-records.js';
import { WorkspaceRecordStore } from './workspace-record-store.js';
import type { WorkspaceMemoryPatch } from './workspace-types.js';

export class WorkspaceMemoryService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly eventService: Pick<EventService, 'emit'>,
    private readonly recordStore: WorkspaceRecordStore,
  ) {}

  async patchWorkspaceMemoryEntries(
    identity: ApiKeyIdentity,
    workspaceId: string,
    patches: WorkspaceMemoryPatch[],
    client?: DatabaseClient,
  ) {
    if (patches.length === 0) {
      throw new ValidationError('Workspace memory updates cannot be empty');
    }

    const ownsTransaction = !client;
    const db = client ?? (await this.pool.connect());

    try {
      if (ownsTransaction) {
        await db.query('BEGIN');
      }

      let workspace = await this.recordStore.loadWorkspaceForMemoryMutation(
        identity.tenantId,
        workspaceId,
        db,
      );
      let currentMemory = normalizeRecord(workspace.memory);

      for (const patch of patches) {
        if (!patch.key || patch.key.length > 256) {
          throw new ValidationError('Workspace memory key must be between 1 and 256 characters');
        }

        const sanitizedValue = sanitizeMemoryValueForPersistence(patch.key, patch.value);
        const nextMemory = {
          ...currentMemory,
          [patch.key]: sanitizedValue,
        };
        const memoryMaxBytes = Number(workspace.memory_max_bytes ?? 1_048_576);
        const memorySizeBytes = byteLengthJson(nextMemory);

        if (memorySizeBytes > memoryMaxBytes) {
          throw new ValidationError('Workspace memory patch exceeds memory_max_bytes', {
            memory_size_bytes: memorySizeBytes,
            memory_max_bytes: memoryMaxBytes,
            key: patch.key,
          });
        }

        const result = await db.query<Record<string, unknown>>(
          `UPDATE workspaces
           SET memory = $3,
               memory_size_bytes = $4,
               updated_at = now()
           WHERE tenant_id = $1 AND id = $2
           RETURNING *`,
          [identity.tenantId, workspaceId, nextMemory, memorySizeBytes],
        );

        workspace = result.rows[0] as typeof workspace;
        currentMemory = normalizeRecord(workspace.memory);

        await this.eventService.emit(
          {
            tenantId: identity.tenantId,
            type: 'workspace.memory_updated',
            entityType: 'workspace',
            entityId: workspaceId,
            actorType: identity.scope,
            actorId: identity.keyPrefix,
            data: {
              key: patch.key,
              value: sanitizeMemoryEventValue(patch.key, patch.value),
              workspace_id: workspaceId,
              workflow_id: patch.context?.workflow_id ?? null,
              work_item_id: patch.context?.work_item_id ?? null,
              task_id: patch.context?.task_id ?? null,
              stage_name: patch.context?.stage_name ?? null,
              memory_size_bytes: memorySizeBytes,
            },
          },
          db,
        );
      }

      if (ownsTransaction) {
        await db.query('COMMIT');
      }

      return redactWorkspaceSecrets(workspace);
    } catch (error) {
      if (ownsTransaction) {
        await db.query('ROLLBACK');
      }
      throw error;
    } finally {
      if (ownsTransaction) {
        db.release();
      }
    }
  }

  async removeWorkspaceMemory(
    identity: ApiKeyIdentity,
    workspaceId: string,
    key: string,
    client?: DatabaseClient,
    context?: WorkspaceMemoryMutationContext,
  ) {
    const workspace = await this.recordStore.loadWorkspaceRecord(identity.tenantId, workspaceId);
    const currentMemory = normalizeRecord(workspace.memory);
    if (!(key in currentMemory)) {
      return redactWorkspaceSecrets(workspace);
    }

    const nextMemory = { ...currentMemory };
    delete nextMemory[key];
    const memorySizeBytes = byteLengthJson(nextMemory);

    const db = client ?? this.pool;
    const result = await db.query<Record<string, unknown>>(
      `UPDATE workspaces
       SET memory = $3,
           memory_size_bytes = $4,
           updated_at = now()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [identity.tenantId, workspaceId, nextMemory, memorySizeBytes],
    );

    const updatedWorkspace = result.rows[0] as typeof workspace;
    await this.eventService.emit(
      {
        tenantId: identity.tenantId,
        type: 'workspace.memory_deleted',
        entityType: 'workspace',
        entityId: workspaceId,
        actorType: identity.scope,
        actorId: identity.keyPrefix,
        data: {
          key,
          deleted_value: sanitizeMemoryEventValue(key, currentMemory[key]),
          workspace_id: workspaceId,
          workflow_id: context?.workflow_id ?? null,
          work_item_id: context?.work_item_id ?? null,
          task_id: context?.task_id ?? null,
          stage_name: context?.stage_name ?? null,
          memory_size_bytes: memorySizeBytes,
        },
      },
      client,
    );

    return redactWorkspaceSecrets(updatedWorkspace);
  }
}
