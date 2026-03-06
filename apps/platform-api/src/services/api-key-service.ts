import type { ApiKeyIdentity } from '../auth/api-key.js';
import { createApiKey } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { NotFoundError } from '../errors/domain-errors.js';

function readApiKeyRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    scope: String(row.scope),
    owner_type: String(row.owner_type),
    owner_id: row.owner_id ? String(row.owner_id) : null,
    label: row.label ? String(row.label) : null,
    key_prefix: String(row.key_prefix),
    last_used_at: row.last_used_at ?? null,
    expires_at: row.expires_at,
    is_revoked: row.is_revoked === true,
    created_at: row.created_at,
  };
}

export class ApiKeyService {
  constructor(private readonly pool: DatabasePool) {}

  async listApiKeys(tenantId: string) {
    const result = await this.pool.query(
      `SELECT id, tenant_id, scope, owner_type, owner_id, label, key_prefix, last_used_at, expires_at, is_revoked, created_at
       FROM api_keys
       WHERE tenant_id = $1
       ORDER BY created_at DESC`,
      [tenantId],
    );

    return result.rows.map((row) => readApiKeyRow(row as Record<string, unknown>));
  }

  async createApiKey(
    identity: ApiKeyIdentity,
    input: {
      scope: 'agent' | 'worker' | 'admin';
      owner_type: string;
      owner_id?: string;
      label?: string;
      expires_at: string;
    },
  ) {
    const created = await createApiKey(this.pool, {
      tenantId: identity.tenantId,
      scope: input.scope,
      ownerType: input.owner_type,
      ownerId: input.owner_id,
      label: input.label,
      expiresAt: new Date(input.expires_at),
    });

    return {
      api_key: created.apiKey,
      key_prefix: created.keyPrefix,
    };
  }

  async revokeApiKey(identity: ApiKeyIdentity, apiKeyId: string) {
    const result = await this.pool.query(
      `UPDATE api_keys
       SET is_revoked = true
       WHERE tenant_id = $1 AND id = $2
       RETURNING id`,
      [identity.tenantId, apiKeyId],
    );

    if (!result.rowCount) {
      throw new NotFoundError('API key not found');
    }

    return { id: apiKeyId, revoked: true };
  }
}
