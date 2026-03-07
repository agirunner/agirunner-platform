import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { NotFoundError } from '../errors/domain-errors.js';
import { EventService } from './event-service.js';
import { normalizeInstructionDocument } from './instruction-policy.js';

export class PlatformInstructionService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly eventService: EventService,
  ) {}

  async getCurrent(tenantId: string) {
    const result = await this.pool.query(
      `SELECT tenant_id, version, content, format, updated_at, updated_by_type, updated_by_id
         FROM platform_instructions
        WHERE tenant_id = $1`,
      [tenantId],
    );

    if (!result.rowCount) {
      return this.emptyDocument(tenantId);
    }
    return normalizeRow(result.rows[0]);
  }

  async put(identity: ApiKeyIdentity, payload: { content: string; format?: string }) {
    const document = normalizeInstructionDocument(payload, 'platform instructions', 10_000) ?? {
      content: '',
      format: 'text',
    };
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<{ version: number }>(
        'SELECT version FROM platform_instructions WHERE tenant_id = $1 FOR UPDATE',
        [identity.tenantId],
      );
      const nextVersion = (current.rows[0]?.version ?? 0) + 1;

      await client.query(
        `INSERT INTO platform_instructions (tenant_id, version, content, format, updated_by_type, updated_by_id)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (tenant_id)
         DO UPDATE SET version = EXCLUDED.version,
                       content = EXCLUDED.content,
                       format = EXCLUDED.format,
                       updated_at = now(),
                       updated_by_type = EXCLUDED.updated_by_type,
                       updated_by_id = EXCLUDED.updated_by_id`,
        [
          identity.tenantId,
          nextVersion,
          document.content,
          document.format,
          identity.scope,
          identity.keyPrefix,
        ],
      );

      await client.query(
        `INSERT INTO platform_instruction_versions
          (tenant_id, version, content, format, created_by_type, created_by_id)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          identity.tenantId,
          nextVersion,
          document.content,
          document.format,
          identity.scope,
          identity.keyPrefix,
        ],
      );

      await this.eventService.emit(
        {
          tenantId: identity.tenantId,
          type: 'platform.instructions_updated',
          entityType: 'system',
          entityId: identity.tenantId,
          actorType: identity.scope,
          actorId: identity.keyPrefix,
          data: { version: nextVersion },
        },
        client,
      );

      await client.query('COMMIT');
      return this.getCurrent(identity.tenantId);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async clear(identity: ApiKeyIdentity) {
    return this.put(identity, { content: '', format: 'text' });
  }

  async listVersions(tenantId: string) {
    const result = await this.pool.query(
      `SELECT id, tenant_id, version, content, format, created_at, created_by_type, created_by_id
         FROM platform_instruction_versions
        WHERE tenant_id = $1
        ORDER BY version DESC`,
      [tenantId],
    );
    return {
      data: result.rows.map(normalizeVersionRow),
    };
  }

  async getVersion(tenantId: string, version: number) {
    const result = await this.pool.query(
      `SELECT id, tenant_id, version, content, format, created_at, created_by_type, created_by_id
         FROM platform_instruction_versions
        WHERE tenant_id = $1 AND version = $2`,
      [tenantId, version],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Platform instruction version not found');
    }
    return normalizeVersionRow(result.rows[0]);
  }

  private emptyDocument(tenantId: string) {
    return {
      tenant_id: tenantId,
      version: 0,
      content: '',
      format: 'text',
      updated_at: null,
      updated_by_type: null,
      updated_by_id: null,
    };
  }
}

function normalizeRow(row: Record<string, unknown>) {
  return {
    tenant_id: row.tenant_id,
    version: row.version,
    content: row.content,
    format: row.format,
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    updated_by_type: row.updated_by_type ?? null,
    updated_by_id: row.updated_by_id ?? null,
  };
}

function normalizeVersionRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    version: row.version,
    content: row.content,
    format: row.format,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    created_by_type: row.created_by_type ?? null,
    created_by_id: row.created_by_id ?? null,
  };
}
