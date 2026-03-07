import type { ArtifactStorageAdapter } from '../content/artifact-storage.js';
import type { DatabaseClient, DatabasePool } from '../db/database.js';

interface RetainedArtifactRow {
  id: string;
  storage_key: string;
}

export class ArtifactRetentionService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly storage: ArtifactStorageAdapter,
  ) {}

  async purgeExpiredArtifacts(tenantId: string, client?: DatabaseClient): Promise<number> {
    return this.deleteArtifacts(
      client ?? this.pool,
      `SELECT id, storage_key
         FROM pipeline_artifacts
        WHERE tenant_id = $1
          AND expires_at IS NOT NULL
          AND expires_at <= now()`,
      [tenantId],
    );
  }

  async purgePipelineArtifactsOnTerminalState(
    tenantId: string,
    pipelineId: string,
    client?: DatabaseClient,
  ): Promise<number> {
    return this.deleteArtifacts(
      client ?? this.pool,
      `SELECT id, storage_key
         FROM pipeline_artifacts
        WHERE tenant_id = $1
          AND pipeline_id = $2
          AND (
            retention_policy ->> 'mode' = 'ephemeral'
            OR COALESCE((retention_policy ->> 'destroy_on_pipeline_complete')::boolean, false)
          )`,
      [tenantId, pipelineId],
    );
  }

  private async deleteArtifacts(
    db: DatabaseClient | DatabasePool,
    sql: string,
    values: unknown[],
  ): Promise<number> {
    const artifacts = await db.query<RetainedArtifactRow>(sql, values);
    if (!artifacts.rowCount) {
      return 0;
    }

    for (const artifact of artifacts.rows) {
      await this.storage.deleteObject(artifact.storage_key);
    }

    await db.query(
      `DELETE FROM pipeline_artifacts
        WHERE id = ANY($1::uuid[])`,
      [artifacts.rows.map((artifact) => artifact.id)],
    );

    return artifacts.rowCount;
  }
}
