import type { ApiKeyIdentity } from '../../auth/api-key.js';
import type { ArtifactStorageAdapter } from '../../content/artifact-storage.js';
import type { DatabaseClient, DatabasePool } from '../../db/database.js';
import { ConflictError, NotFoundError } from '../../errors/domain-errors.js';
import type { EventService } from '../event-service.js';

type DeleteWorkflowInput = {
  artifactStorage: ArtifactStorageAdapter;
  eventService: EventService;
  identity: ApiKeyIdentity;
  pool: DatabasePool;
  workflowId: string;
};

export async function deleteWorkflow(input: DeleteWorkflowInput) {
  const client = await input.pool.connect();
  try {
    await client.query('BEGIN');
    const workflowResult = await client.query<{ state: string }>(
      'SELECT state FROM workflows WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
      [input.identity.tenantId, input.workflowId],
    );

    if (!workflowResult.rowCount) {
      throw new NotFoundError('Workflow not found');
    }

    const state = workflowResult.rows[0].state;
    if (!new Set(['completed', 'failed', 'cancelled']).has(state)) {
      throw new ConflictError('Only terminal workflows can be deleted');
    }

    await deleteWorkflowStoredObjects(
      client,
      input.artifactStorage,
      input.identity.tenantId,
      input.workflowId,
    );
    await client.query('DELETE FROM tasks WHERE tenant_id = $1 AND workflow_id = $2', [
      input.identity.tenantId,
      input.workflowId,
    ]);
    await client.query('DELETE FROM workflows WHERE tenant_id = $1 AND id = $2', [
      input.identity.tenantId,
      input.workflowId,
    ]);

    await input.eventService.emit(
      {
        tenantId: input.identity.tenantId,
        type: 'workflow.deleted',
        entityType: 'workflow',
        entityId: input.workflowId,
        actorType: input.identity.scope,
        actorId: input.identity.keyPrefix,
        data: { previous_state: state },
      },
      client,
    );

    await client.query('COMMIT');
    return { id: input.workflowId, deleted: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function deleteWorkflowStoredObjects(
  client: DatabaseClient,
  artifactStorage: ArtifactStorageAdapter,
  tenantId: string,
  workflowId: string,
): Promise<void> {
  const result = await client.query<{ storage_key: string }>(
    `SELECT DISTINCT storage_key
       FROM (
         SELECT storage_key
           FROM workflow_artifacts
          WHERE tenant_id = $1
            AND workflow_id = $2
         UNION ALL
         SELECT storage_key
           FROM workflow_input_packet_files
          WHERE tenant_id = $1
            AND workflow_id = $2
         UNION ALL
         SELECT storage_key
           FROM workflow_intervention_files
          WHERE tenant_id = $1
            AND workflow_id = $2
       ) stored_files`,
    [tenantId, workflowId],
  );

  const keys = Array.from(new Set(result.rows.map((row) => row.storage_key).filter(Boolean)));
  for (const storageKey of keys) {
    await artifactStorage.deleteObject(storageKey);
  }
}
