import type { DatabaseQueryable } from '../../db/database.js';
import type {
  CommunityCatalogArtifactType,
  CommunityCatalogImportLinkRecord,
  CommunityCatalogOriginRecord,
} from './community-catalog-types.js';

export class CommunityCatalogPersistence {
  constructor(private readonly pool: DatabaseQueryable) {}

  async createImportBatch(
    tenantId: string,
    input: {
      repository: string;
      ref: string;
      playbookIds: string[];
      sourceCommitSha?: string | null;
    },
  ): Promise<{ id: string }> {
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO catalog_import_batches (
         tenant_id,
         source_kind,
         source_repository,
         source_ref,
         source_commit_sha,
         requested_playbook_ids
       ) VALUES ($1, 'github_catalog', $2, $3, $4, $5::text[])
       RETURNING id`,
      [tenantId, input.repository, input.ref, input.sourceCommitSha ?? null, input.playbookIds],
    );
    return result.rows[0]!;
  }

  async upsertImportLink(
    tenantId: string,
    input: {
      importBatchId: string;
      artifactType: CommunityCatalogArtifactType;
      catalogId: string;
      catalogName: string;
      catalogVersion?: string | null;
      catalogPath: string;
      sourceRepository: string;
      sourceRef: string;
      sourceCommitSha?: string | null;
      localEntityId: string;
    },
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO catalog_import_links (
         tenant_id,
         import_batch_id,
         artifact_type,
         catalog_id,
         catalog_name,
         catalog_version,
         catalog_path,
         source_repository,
         source_ref,
         source_commit_sha,
         local_entity_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (tenant_id, artifact_type, local_entity_id)
       DO UPDATE SET
         import_batch_id = EXCLUDED.import_batch_id,
         catalog_id = EXCLUDED.catalog_id,
         catalog_name = EXCLUDED.catalog_name,
         catalog_version = EXCLUDED.catalog_version,
         catalog_path = EXCLUDED.catalog_path,
         source_repository = EXCLUDED.source_repository,
         source_ref = EXCLUDED.source_ref,
         source_commit_sha = EXCLUDED.source_commit_sha,
         created_at = now()`,
      [
        tenantId,
        input.importBatchId,
        input.artifactType,
        input.catalogId,
        input.catalogName,
        input.catalogVersion ?? null,
        input.catalogPath,
        input.sourceRepository,
        input.sourceRef,
        input.sourceCommitSha ?? null,
        input.localEntityId,
      ],
    );
  }

  async findLatestLinksByCatalogIds(
    tenantId: string,
    artifactType: CommunityCatalogArtifactType,
    catalogIds: string[],
  ): Promise<CommunityCatalogImportLinkRecord[]> {
    if (catalogIds.length === 0) {
      return [];
    }

    const result = await this.pool.query<{
      artifact_type: CommunityCatalogArtifactType;
      catalog_id: string;
      catalog_name: string;
      catalog_version: string | null;
      local_entity_id: string;
    }>(
      `SELECT DISTINCT ON (catalog_id)
         artifact_type,
         catalog_id,
         catalog_name,
         catalog_version,
         local_entity_id
       FROM catalog_import_links
       WHERE tenant_id = $1
         AND artifact_type = $2
         AND catalog_id = ANY($3::text[])
       ORDER BY catalog_id, created_at DESC`,
      [tenantId, artifactType, catalogIds],
    );

    return result.rows.map((row) => ({
      artifactType: row.artifact_type,
      catalogId: row.catalog_id,
      catalogName: row.catalog_name,
      catalogVersion: row.catalog_version,
      localEntityId: row.local_entity_id,
      matchKind: 'catalog_link',
    }));
  }

  async getPlaybookOrigin(tenantId: string, playbookId: string): Promise<CommunityCatalogOriginRecord | null> {
    const result = await this.pool.query<{
      catalog_id: string;
      catalog_name: string;
      catalog_version: string | null;
    }>(
      `SELECT catalog_id, catalog_name, catalog_version
       FROM catalog_import_links
       WHERE tenant_id = $1
         AND artifact_type = 'playbook'
         AND local_entity_id = $2
       LIMIT 1`,
      [tenantId, playbookId],
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return {
      catalogId: row.catalog_id,
      catalogName: row.catalog_name,
      catalogVersion: row.catalog_version,
    };
  }
}
