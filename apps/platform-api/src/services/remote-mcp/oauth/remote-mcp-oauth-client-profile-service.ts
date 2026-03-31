import { ConflictError, NotFoundError } from '../../../errors/domain-errors.js';
import type { DatabaseQueryable } from '../../../db/database.js';
import { assertClientSecretAuthMethod } from './remote-mcp-oauth-client-auth.js';
import {
  decryptRemoteMcpSecret,
  encryptRemoteMcpSecret,
} from '../core/remote-mcp-secret-crypto.js';
import {
  remoteMcpOAuthClientProfileCreateSchema,
  remoteMcpOAuthClientProfileUpdateSchema,
  type RemoteMcpOAuthClientProfileCreateInput,
  type RemoteMcpOAuthClientProfileUpdateInput,
} from './remote-mcp-oauth-client-profile-model.js';

interface ProfileRow {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  description: string;
  issuer: string | null;
  authorization_endpoint: string | null;
  token_endpoint: string;
  registration_endpoint: string | null;
  device_authorization_endpoint: string | null;
  callback_mode: 'loopback' | 'hosted_https';
  token_endpoint_auth_method: 'none' | 'client_secret_post' | 'client_secret_basic' | 'private_key_jwt';
  client_id: string;
  encrypted_client_secret: string | null;
  default_scopes: unknown;
  default_resource_indicators: unknown;
  default_audiences: unknown;
  linked_server_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface RemoteMcpOAuthClientProfileRecord {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  description: string;
  issuer: string | null;
  authorization_endpoint: string | null;
  token_endpoint: string;
  registration_endpoint: string | null;
  device_authorization_endpoint: string | null;
  callback_mode: 'loopback' | 'hosted_https';
  token_endpoint_auth_method: 'none' | 'client_secret_post' | 'client_secret_basic' | 'private_key_jwt';
  client_id: string;
  client_secret: string | null;
  has_stored_client_secret: boolean;
  default_scopes: string[];
  default_resource_indicators: string[];
  default_audiences: string[];
  linked_server_count: number;
  created_at: Date;
  updated_at: Date;
}

export class RemoteMcpOAuthClientProfileService {
  constructor(private readonly pool: DatabaseQueryable) {}

  async listProfiles(tenantId: string): Promise<RemoteMcpOAuthClientProfileRecord[]> {
    const result = await this.pool.query<ProfileRow>(listProfilesSql(), [tenantId]);
    return result.rows.map((row) => toProfileRecord(row, false));
  }

  async getProfile(tenantId: string, id: string): Promise<RemoteMcpOAuthClientProfileRecord> {
    const result = await this.pool.query<ProfileRow>(`${listProfilesSql()} AND p.id = $2`, [tenantId, id]);
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundError('Remote MCP OAuth client profile not found');
    }
    return toProfileRecord(row, false);
  }

  async getStoredProfile(tenantId: string, id: string): Promise<RemoteMcpOAuthClientProfileRecord> {
    const result = await this.pool.query<ProfileRow>(`${listProfilesSql()} AND p.id = $2`, [tenantId, id]);
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundError('Remote MCP OAuth client profile not found');
    }
    return toProfileRecord(row, true);
  }

  async createProfile(
    tenantId: string,
    input: RemoteMcpOAuthClientProfileCreateInput,
  ): Promise<RemoteMcpOAuthClientProfileRecord> {
    const validated = remoteMcpOAuthClientProfileCreateSchema.parse(input);
    assertClientSecretAuthMethod({
      clientSecret: validated.clientSecret ?? null,
      tokenEndpointAuthMethod: validated.tokenEndpointAuthMethod,
    });
    const slug = normalizeSlug(validated.name);
    await this.assertUniqueSlug(tenantId, slug);
    const insert = await this.pool.query<{ id: string }>(
      `INSERT INTO remote_mcp_oauth_client_profiles (
         tenant_id, name, slug, description, issuer, authorization_endpoint, token_endpoint,
         registration_endpoint, device_authorization_endpoint, callback_mode,
         token_endpoint_auth_method, client_id, encrypted_client_secret,
         default_scopes, default_resource_indicators, default_audiences
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb, $16::jsonb)
       RETURNING id`,
      [
        tenantId,
        validated.name.trim(),
        slug,
        validated.description.trim(),
        normalizeNullable(validated.issuer),
        validated.authorizationEndpoint ?? null,
        validated.tokenEndpoint.trim(),
        validated.registrationEndpoint ?? null,
        validated.deviceAuthorizationEndpoint ?? null,
        validated.callbackMode,
        validated.tokenEndpointAuthMethod,
        validated.clientId.trim(),
        encryptNullableSecret(validated.clientSecret),
        JSON.stringify(validated.defaultScopes),
        JSON.stringify(validated.defaultResourceIndicators),
        JSON.stringify(validated.defaultAudiences),
      ],
    ).catch(handleWriteError);
    return this.getProfile(tenantId, insert.rows[0].id);
  }

  async updateProfile(
    tenantId: string,
    id: string,
    input: RemoteMcpOAuthClientProfileUpdateInput,
  ): Promise<RemoteMcpOAuthClientProfileRecord> {
    const current = await this.getStoredProfile(tenantId, id);
    const validated = remoteMcpOAuthClientProfileUpdateSchema.parse(input);
    const nextName = validated.name?.trim() ?? current.name;
    const nextSlug = normalizeSlug(nextName);
    if (nextSlug !== current.slug) {
      await this.assertUniqueSlug(tenantId, nextSlug, id);
    }
    const next = {
      description: validated.description?.trim() ?? current.description,
      issuer: normalizeNullable(validated.issuer) ?? current.issuer,
      authorizationEndpoint: validated.authorizationEndpoint ?? current.authorization_endpoint,
      tokenEndpoint: validated.tokenEndpoint?.trim() ?? current.token_endpoint,
      registrationEndpoint: validated.registrationEndpoint ?? current.registration_endpoint,
      deviceAuthorizationEndpoint: validated.deviceAuthorizationEndpoint ?? current.device_authorization_endpoint,
      callbackMode: validated.callbackMode ?? current.callback_mode,
      tokenEndpointAuthMethod: validated.tokenEndpointAuthMethod ?? current.token_endpoint_auth_method,
      clientId: validated.clientId?.trim() ?? current.client_id,
      clientSecret:
        validated.clientSecret === undefined
          ? current.client_secret
          : normalizeNullable(validated.clientSecret),
      defaultScopes: validated.defaultScopes ?? current.default_scopes,
      defaultResourceIndicators: validated.defaultResourceIndicators ?? current.default_resource_indicators,
      defaultAudiences: validated.defaultAudiences ?? current.default_audiences,
    };
    assertClientSecretAuthMethod({
      clientSecret: next.clientSecret,
      tokenEndpointAuthMethod: next.tokenEndpointAuthMethod,
    });
    await this.pool.query(
      `UPDATE remote_mcp_oauth_client_profiles
          SET name = $3,
              slug = $4,
              description = $5,
              issuer = $6,
              authorization_endpoint = $7,
              token_endpoint = $8,
              registration_endpoint = $9,
              device_authorization_endpoint = $10,
              callback_mode = $11,
              token_endpoint_auth_method = $12,
              client_id = $13,
              encrypted_client_secret = $14,
              default_scopes = $15::jsonb,
              default_resource_indicators = $16::jsonb,
              default_audiences = $17::jsonb,
              updated_at = now()
        WHERE tenant_id = $1
          AND id = $2`,
      [
        tenantId,
        id,
        nextName,
        nextSlug,
        next.description,
        next.issuer,
        next.authorizationEndpoint,
        next.tokenEndpoint,
        next.registrationEndpoint,
        next.deviceAuthorizationEndpoint,
        next.callbackMode,
        next.tokenEndpointAuthMethod,
        next.clientId,
        encryptNullableSecret(next.clientSecret),
        JSON.stringify(next.defaultScopes),
        JSON.stringify(next.defaultResourceIndicators),
        JSON.stringify(next.defaultAudiences),
      ],
    ).catch(handleWriteError);
    if (profileConnectionChanged(current, next)) {
      await this.disconnectLinkedServers(id);
    }
    return this.getProfile(tenantId, id);
  }

  async deleteProfile(tenantId: string, id: string): Promise<void> {
    const current = await this.getStoredProfile(tenantId, id);
    if (current.linked_server_count > 0) {
      throw new ConflictError('Remote MCP OAuth client profile is still assigned to registered MCP servers');
    }
    const result = await this.pool.query(
      `DELETE FROM remote_mcp_oauth_client_profiles
        WHERE tenant_id = $1
          AND id = $2
        RETURNING id`,
      [tenantId, id],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Remote MCP OAuth client profile not found');
    }
  }

  private async disconnectLinkedServers(profileId: string): Promise<void> {
    await this.pool.query(
      `UPDATE remote_mcp_servers
          SET oauth_config = NULL,
              oauth_credentials = NULL,
              verification_status = 'failed',
              verification_error = 'OAuth client profile changed. Reconnect OAuth.',
              verified_transport = NULL,
              verified_at = NULL,
              updated_at = now()
        WHERE oauth_client_profile_id = $1`,
      [profileId],
    );
  }

  private async assertUniqueSlug(tenantId: string, slug: string, currentId?: string): Promise<void> {
    const result = await this.pool.query<{ id: string }>(
      `SELECT id FROM remote_mcp_oauth_client_profiles WHERE tenant_id = $1 AND slug = $2 LIMIT 1`,
      [tenantId, slug],
    );
    const row = result.rows[0];
    if (row && row.id !== currentId) {
      throw new ConflictError('Remote MCP OAuth client profile name already exists');
    }
  }
}

function listProfilesSql(): string {
  return `SELECT
    p.*,
    COALESCE((
      SELECT COUNT(*)::integer
        FROM remote_mcp_servers s
       WHERE s.oauth_client_profile_id = p.id
    ), 0) AS linked_server_count
  FROM remote_mcp_oauth_client_profiles p
  WHERE p.tenant_id = $1`;
}

function toProfileRecord(row: ProfileRow, exposeSecretValue: boolean): RemoteMcpOAuthClientProfileRecord {
  const secret = typeof row.encrypted_client_secret === 'string' && row.encrypted_client_secret.trim().length > 0
    ? row.encrypted_client_secret
    : null;
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    issuer: row.issuer,
    authorization_endpoint: row.authorization_endpoint,
    token_endpoint: row.token_endpoint,
    registration_endpoint: row.registration_endpoint,
    device_authorization_endpoint: row.device_authorization_endpoint,
    callback_mode: row.callback_mode,
    token_endpoint_auth_method: row.token_endpoint_auth_method,
    client_id: row.client_id,
    client_secret: secret
      ? exposeSecretValue
        ? decryptRemoteMcpSecret(secret)
        : 'redacted://remote-mcp-secret'
      : null,
    has_stored_client_secret: secret !== null,
    default_scopes: normalizeStringArray(row.default_scopes),
    default_resource_indicators: normalizeStringArray(row.default_resource_indicators),
    default_audiences: normalizeStringArray(row.default_audiences),
    linked_server_count: row.linked_server_count ?? 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function profileConnectionChanged(
  current: RemoteMcpOAuthClientProfileRecord,
  next: {
    issuer: string | null;
    authorizationEndpoint: string | null;
    tokenEndpoint: string;
    registrationEndpoint: string | null;
    deviceAuthorizationEndpoint: string | null;
    callbackMode: 'loopback' | 'hosted_https';
    tokenEndpointAuthMethod: 'none' | 'client_secret_post' | 'client_secret_basic' | 'private_key_jwt';
    clientId: string;
    clientSecret: string | null;
    defaultScopes: string[];
    defaultResourceIndicators: string[];
    defaultAudiences: string[];
  },
): boolean {
  return current.issuer !== next.issuer
    || current.authorization_endpoint !== next.authorizationEndpoint
    || current.token_endpoint !== next.tokenEndpoint
    || current.registration_endpoint !== next.registrationEndpoint
    || current.device_authorization_endpoint !== next.deviceAuthorizationEndpoint
    || current.callback_mode !== next.callbackMode
    || current.token_endpoint_auth_method !== next.tokenEndpointAuthMethod
    || current.client_id !== next.clientId
    || current.client_secret !== next.clientSecret
    || JSON.stringify(current.default_scopes) !== JSON.stringify(next.defaultScopes)
    || JSON.stringify(current.default_resource_indicators) !== JSON.stringify(next.defaultResourceIndicators)
    || JSON.stringify(current.default_audiences) !== JSON.stringify(next.defaultAudiences);
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => typeof entry === 'string' && entry.trim().length > 0 ? [entry.trim()] : []);
}

function normalizeNullable(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function encryptNullableSecret(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? encryptRemoteMcpSecret(value.trim())
    : null;
}

function normalizeSlug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
}

function handleWriteError(error: unknown): never {
  if (error instanceof Error && /uq_remote_mcp_oauth_client_profiles_tenant_slug/i.test(error.message)) {
    throw new ConflictError('Remote MCP OAuth client profile name already exists');
  }
  throw error;
}
