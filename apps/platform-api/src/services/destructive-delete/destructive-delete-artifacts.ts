import type { ArtifactStorageAdapter } from '../../content/artifact-storage.js';
import type { DatabaseClient } from '../../db/database.js';

import { uniqueIds } from './destructive-delete-queries.js';

export async function deleteWorkflowArtifacts(
  db: DatabaseClient,
  artifactStorage: Pick<ArtifactStorageAdapter, 'deleteObject'> | undefined,
  tenantId: string,
  workflowIds: string[],
  taskIds: string[],
  workspaceId: string | null,
): Promise<void> {
  const params = [tenantId, workflowIds, taskIds, workspaceId];
  await deleteStoredArtifacts(
    db,
    artifactStorage,
    `SELECT DISTINCT storage_key
       FROM workflow_artifacts
      WHERE tenant_id = $1
        AND (
          workflow_id = ANY($2::uuid[])
          OR task_id = ANY($3::uuid[])
          OR ($4::uuid IS NOT NULL AND workspace_id = $4::uuid)
        )`,
    params,
  );
  await db.query(
    `DELETE FROM workflow_artifacts
      WHERE tenant_id = $1
        AND (
          workflow_id = ANY($2::uuid[])
          OR task_id = ANY($3::uuid[])
          OR ($4::uuid IS NOT NULL AND workspace_id = $4::uuid)
        )`,
    params,
  );
}

export async function deleteWorkspaceArtifactFiles(
  db: DatabaseClient,
  artifactStorage: Pick<ArtifactStorageAdapter, 'deleteObject'> | undefined,
  tenantId: string,
  workspaceId: string,
): Promise<void> {
  const params = [tenantId, workspaceId];
  await deleteStoredArtifacts(
    db,
    artifactStorage,
    `SELECT DISTINCT storage_key
       FROM workspace_artifact_files
      WHERE tenant_id = $1
        AND workspace_id = $2`,
    params,
  );
  await db.query(
    `DELETE FROM workspace_artifact_files
      WHERE tenant_id = $1
        AND workspace_id = $2`,
    params,
  );
}

export async function deleteStoredArtifacts(
  db: Pick<DatabaseClient, 'query'>,
  artifactStorage: Pick<ArtifactStorageAdapter, 'deleteObject'> | undefined,
  sql: string,
  values: unknown[],
): Promise<void> {
  if (!artifactStorage) {
    return;
  }

  const result = await db.query<{ storage_key: string }>(sql, values);
  for (const storageKey of uniqueIds(result.rows.map((row) => row.storage_key))) {
    await artifactStorage.deleteObject(storageKey);
  }
}

export function deleteWorkspaceScopedTasks(
  client: DatabaseClient,
  tenantId: string,
  workspaceId: string,
) {
  return client.query<{ id: string }>(
    `DELETE FROM tasks
      WHERE tenant_id = $1
        AND workspace_id = $2
    RETURNING id`,
    [tenantId, workspaceId],
  );
}
