import type { ApiKeyIdentity } from '../auth/api-key.js';
import { createApiKey } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { NotFoundError } from '../errors/domain-errors.js';
import { isOperatorScope, type ApiKeyScope } from '../auth/scope.js';

const REVOKED_OPERATOR_KEY_UI_GRACE_MS = 60 * 60 * 1000;

function readApiKeyRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    scope: String(row.scope) as ApiKeyScope,
    owner_type: String(row.owner_type),
    owner_id: row.owner_id ? String(row.owner_id) : null,
    label: row.label ? String(row.label) : null,
    key_prefix: String(row.key_prefix),
    last_used_at: row.last_used_at ?? null,
    expires_at: row.expires_at,
    is_revoked: row.is_revoked === true,
    revoked_at: row.revoked_at ?? null,
    created_at: row.created_at,
  };
}

function shouldHideFromDashboard(
  key: ReturnType<typeof readApiKeyRow>,
  now: Date,
): boolean {
  if (!isOperatorScope(key.scope) || !key.is_revoked || !key.revoked_at) {
    return false;
  }

  return now.getTime() - new Date(String(key.revoked_at)).getTime() > REVOKED_OPERATOR_KEY_UI_GRACE_MS;
}

function defaultOwnerTypeForScope(scope: ApiKeyScope): string {
  return scope === 'service' ? 'service' : 'user';
}

export class ApiKeyService {
  constructor(private readonly pool: DatabasePool) {}

  async listApiKeys(tenantId: string, now = new Date()) {
    const result = await this.pool.query(
      `SELECT id, tenant_id, scope, owner_type, owner_id, label, key_prefix, last_used_at, expires_at, is_revoked, revoked_at, created_at
       FROM api_keys
       WHERE tenant_id = $1
       ORDER BY created_at DESC`,
      [tenantId],
    );

    return result.rows
      .map((row) => readApiKeyRow(row as Record<string, unknown>))
      .filter((key) => !shouldHideFromDashboard(key, now));
  }

  async createApiKey(
    identity: ApiKeyIdentity,
    input: {
      scope: 'admin' | 'service';
      owner_type?: string;
      owner_id?: string;
      label?: string;
      expires_at?: string | null;
    },
  ) {
    const created = await createApiKey(this.pool, {
      tenantId: identity.tenantId,
      scope: input.scope,
      ownerType: input.owner_type ?? defaultOwnerTypeForScope(input.scope),
      ownerId: input.owner_id,
      label: input.label,
      expiresAt: input.expires_at ? new Date(input.expires_at) : undefined,
    });

    return {
      api_key: created.apiKey,
      key_prefix: created.keyPrefix,
    };
  }

  async revokeApiKey(identity: ApiKeyIdentity, apiKeyId: string) {
    const result = await this.pool.query(
      `UPDATE api_keys
       SET is_revoked = true,
           revoked_at = now()
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
