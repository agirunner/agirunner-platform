import { z } from 'zod';

import type { DatabaseQueryable } from '../db/database.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/domain-errors.js';
import {
  decryptRemoteMcpSecret,
  normalizeStoredRemoteMcpSecret,
} from './remote-mcp-secret-crypto.js';

const parameterSchema = z.object({
  placement: z.enum(['path', 'query', 'header', 'initialize_param']),
  key: z.string().min(1).max(200),
  valueKind: z.enum(['static', 'secret']),
  value: z.string(),
}).strict();

const oauthConfigSchema = z.object({
  issuer: z.string().min(1).nullable().optional(),
  authorizationEndpoint: z.string().min(1),
  tokenEndpoint: z.string().min(1),
  registrationEndpoint: z.string().min(1).nullable().optional(),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1).nullable().optional(),
  tokenEndpointAuthMethod: z.enum(['none', 'client_secret_post', 'client_secret_basic']),
  clientIdMetadataDocumentUrl: z.string().min(1).nullable().optional(),
  redirectUri: z.string().min(1),
  scopes: z.array(z.string().min(1)).default([]),
  resource: z.string().min(1),
}).strict();

const oauthCredentialsSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1).nullable().optional(),
  expiresAt: z.number().int().nullable().optional(),
  tokenType: z.string().min(1).nullable().optional(),
  scope: z.string().min(1).nullable().optional(),
  authorizedAt: z.string().min(1),
  authorizedByUserId: z.string().min(1),
  needsReauth: z.boolean().default(false),
}).strict();

const createVerifiedServerSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).default(''),
  endpointUrl: z.string().min(1).max(2000),
  callTimeoutSeconds: z.number().int().min(1).max(86400).default(300),
  authMode: z.enum(['none', 'parameterized', 'oauth']),
  enabledByDefaultForNewSpecialists: z.boolean().default(false),
  grantToAllExistingSpecialists: z.boolean().default(false),
  verificationStatus: z.enum(['unknown', 'verified', 'failed']),
  verificationError: z.string().nullable(),
  verifiedTransport: z.enum(['streamable_http', 'http_sse_compat']).nullable(),
  verificationContractVersion: z.string().min(1),
  discoveredToolsSnapshot: z.array(z.record(z.unknown())).default([]),
  parameters: z.array(parameterSchema).default([]),
  oauthConfig: oauthConfigSchema.nullable().optional(),
  oauthCredentials: oauthCredentialsSchema.nullable().optional(),
}).strict();

const updateVerifiedServerSchema = createVerifiedServerSchema.partial().extend({
  endpointUrl: z.string().min(1).max(2000).optional(),
}).strict();

type ParameterInput = z.infer<typeof parameterSchema>;
export type CreateVerifiedRemoteMcpServerInput = z.infer<typeof createVerifiedServerSchema>;
export type UpdateVerifiedRemoteMcpServerInput = z.infer<typeof updateVerifiedServerSchema>;
export type RemoteMcpOAuthConfigRecord = z.infer<typeof oauthConfigSchema>;
export type RemoteMcpOAuthCredentialsRecord = z.infer<typeof oauthCredentialsSchema>;

interface RemoteMcpServerRow {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  description: string;
  endpoint_url: string;
  call_timeout_seconds: number;
  auth_mode: string;
  enabled_by_default_for_new_specialists: boolean;
  is_archived: boolean;
  verification_status: string;
  verification_error: string | null;
  verified_transport: string | null;
  verified_at: Date | null;
  verification_contract_version: string;
  discovered_tools_snapshot: unknown;
  oauth_config: unknown;
  oauth_credentials: unknown;
  created_at: Date;
  updated_at: Date;
  parameter_rows?: unknown;
  assigned_specialist_count?: number;
}

export interface RemoteMcpServerParameterRecord {
  id: string;
  placement: 'path' | 'query' | 'header' | 'initialize_param';
  key: string;
  value_kind: 'static' | 'secret';
  value: string;
  has_stored_secret: boolean;
}

export interface RemoteMcpServerRecord {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  description: string;
  endpoint_url: string;
  call_timeout_seconds: number;
  auth_mode: 'none' | 'parameterized' | 'oauth';
  enabled_by_default_for_new_specialists: boolean;
  is_archived: boolean;
  verification_status: 'unknown' | 'verified' | 'failed';
  verification_error: string | null;
  verified_transport: 'streamable_http' | 'http_sse_compat' | null;
  verified_at: Date | null;
  verification_contract_version: string;
  discovered_tools_snapshot: Record<string, unknown>[];
  discovered_tool_count: number;
  assigned_specialist_count: number;
  parameters: RemoteMcpServerParameterRecord[];
  oauth_connected: boolean;
  oauth_authorized_at: string | null;
  oauth_needs_reauth: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface StoredRemoteMcpServerRecord extends RemoteMcpServerRecord {
  oauth_config: RemoteMcpOAuthConfigRecord | null;
  oauth_credentials: RemoteMcpOAuthCredentialsRecord | null;
}

export class RemoteMcpServerService {
  constructor(private readonly pool: DatabaseQueryable) {}

  async listServers(tenantId: string): Promise<RemoteMcpServerRecord[]> {
    const result = await this.pool.query<RemoteMcpServerRow>(
      `${listServersSql()} AND s.is_archived = false`,
      [tenantId],
    );
    return result.rows.map((row) => toRemoteMcpServerRecord(row, false));
  }

  async getServer(tenantId: string, id: string): Promise<RemoteMcpServerRecord> {
    const result = await this.pool.query<RemoteMcpServerRow>(
      `${listServersSql()} AND s.id = $2`,
      [tenantId, id],
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundError('Remote MCP server not found');
    }
    return toRemoteMcpServerRecord(row, false);
  }

  async getStoredServer(tenantId: string, id: string): Promise<StoredRemoteMcpServerRecord> {
    const result = await this.pool.query<RemoteMcpServerRow>(
      `${listServersSql()} AND s.id = $2`,
      [tenantId, id],
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundError('Remote MCP server not found');
    }
    return toRemoteMcpServerRecord(row, true) as StoredRemoteMcpServerRecord;
  }

  async createVerifiedServer(
    tenantId: string,
    input: CreateVerifiedRemoteMcpServerInput,
  ): Promise<RemoteMcpServerRecord> {
    const validated = createVerifiedServerSchema.parse(input);
    assertValidEndpointUrl(validated.endpointUrl);
    await this.assertUniqueSlug(tenantId, normalizeSlug(validated.name));
    const insert = await this.pool.query<{ id: string }>(
      `INSERT INTO remote_mcp_servers (
         tenant_id, name, slug, description, endpoint_url, call_timeout_seconds, auth_mode,
         enabled_by_default_for_new_specialists, verification_status, verification_error,
         verified_transport, verified_at, verification_contract_version, discovered_tools_snapshot
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
       RETURNING id`,
      [
        tenantId,
        validated.name.trim(),
        normalizeSlug(validated.name),
        validated.description.trim(),
        validated.endpointUrl.trim(),
        validated.callTimeoutSeconds,
        validated.authMode,
        validated.enabledByDefaultForNewSpecialists,
        validated.verificationStatus,
        validated.verificationError,
        validated.verifiedTransport,
        validated.verificationStatus === 'verified' ? new Date() : null,
        validated.verificationContractVersion,
        JSON.stringify(validated.discoveredToolsSnapshot),
      ],
    ).catch(handleRemoteMcpWriteError);
    const serverId = insert.rows[0].id;
    await this.writeOAuthState(serverId, validated.oauthConfig ?? null, validated.oauthCredentials ?? null);
    await this.replaceParameters(serverId, validated.parameters);
    if (validated.grantToAllExistingSpecialists) {
      await this.grantToAllExistingSpecialists(tenantId, serverId);
    }
    return this.getServer(tenantId, serverId);
  }

  async updateVerifiedServer(
    tenantId: string,
    id: string,
    input: UpdateVerifiedRemoteMcpServerInput,
  ): Promise<RemoteMcpServerRecord> {
    const current = await this.getStoredServer(tenantId, id);
    const validated = updateVerifiedServerSchema.parse(input);
    const name = validated.name?.trim() ?? current.name;
    const slug = normalizeSlug(name);
    if (slug !== current.slug) {
      await this.assertUniqueSlug(tenantId, slug, id);
    }
    const endpointUrl = validated.endpointUrl?.trim() ?? current.endpoint_url;
    assertValidEndpointUrl(endpointUrl);
    await this.pool.query(
      `UPDATE remote_mcp_servers
          SET name = $3,
              slug = $4,
              description = $5,
              endpoint_url = $6,
              call_timeout_seconds = $7,
              auth_mode = $8,
              enabled_by_default_for_new_specialists = $9,
              verification_status = $10,
              verification_error = $11,
              verified_transport = $12,
              verified_at = $13,
              verification_contract_version = $14,
              discovered_tools_snapshot = $15::jsonb,
              oauth_config = $16::jsonb,
              oauth_credentials = $17::jsonb,
              updated_at = now()
        WHERE tenant_id = $1
          AND id = $2`,
      [
        tenantId,
        id,
        name,
        slug,
        validated.description?.trim() ?? current.description,
        endpointUrl,
        validated.callTimeoutSeconds ?? current.call_timeout_seconds,
        validated.authMode ?? current.auth_mode,
        validated.enabledByDefaultForNewSpecialists ?? current.enabled_by_default_for_new_specialists,
        validated.verificationStatus ?? current.verification_status,
        validated.verificationError ?? current.verification_error,
        validated.verifiedTransport ?? current.verified_transport,
        (validated.verificationStatus ?? current.verification_status) === 'verified' ? new Date() : null,
        validated.verificationContractVersion ?? current.verification_contract_version,
        JSON.stringify(validated.discoveredToolsSnapshot ?? current.discovered_tools_snapshot),
        JSON.stringify(validated.oauthConfig ?? current.oauth_config),
        JSON.stringify(validated.oauthCredentials ?? current.oauth_credentials),
      ],
    ).catch(handleRemoteMcpWriteError);
    if (validated.parameters) {
      await this.replaceParameters(id, validated.parameters);
    }
    return this.getServer(tenantId, id);
  }

  async updateMetadataOnly(
    tenantId: string,
    id: string,
    input: { description?: string; enabledByDefaultForNewSpecialists?: boolean },
  ): Promise<RemoteMcpServerRecord> {
    const current = await this.getStoredServer(tenantId, id);
    await this.pool.query(
      `UPDATE remote_mcp_servers
          SET description = $3,
              enabled_by_default_for_new_specialists = $4,
              updated_at = now()
        WHERE tenant_id = $1
          AND id = $2`,
      [tenantId, id, input.description?.trim() ?? current.description, input.enabledByDefaultForNewSpecialists ?? current.enabled_by_default_for_new_specialists],
    );
    return this.getServer(tenantId, id);
  }

  async updateVerificationResult(
    tenantId: string,
    id: string,
    input: Pick<CreateVerifiedRemoteMcpServerInput, 'verificationStatus' | 'verificationError' | 'verifiedTransport' | 'verificationContractVersion' | 'discoveredToolsSnapshot'>,
  ): Promise<RemoteMcpServerRecord> {
    await this.pool.query(
      `UPDATE remote_mcp_servers
          SET verification_status = $3,
              verification_error = $4,
              verified_transport = $5,
              verified_at = $6,
              verification_contract_version = $7,
              discovered_tools_snapshot = $8::jsonb,
              updated_at = now()
        WHERE tenant_id = $1
          AND id = $2`,
      [tenantId, id, input.verificationStatus, input.verificationError, input.verifiedTransport, input.verificationStatus === 'verified' ? new Date() : null, input.verificationContractVersion, JSON.stringify(input.discoveredToolsSnapshot)],
    );
    return this.getServer(tenantId, id);
  }

  async deleteServer(tenantId: string, id: string): Promise<void> {
    await this.getServer(tenantId, id);
    const result = await this.pool.query(
      `DELETE FROM remote_mcp_servers
        WHERE tenant_id = $1
          AND id = $2
        RETURNING id`,
      [tenantId, id],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Remote MCP server not found');
    }
  }

  private async replaceParameters(serverId: string, parameters: ParameterInput[]): Promise<void> {
    await this.pool.query('DELETE FROM remote_mcp_server_parameters WHERE remote_mcp_server_id = $1', [serverId]);
    for (const parameter of parameters) {
      const storedSecret = parameter.valueKind === 'secret' ? normalizeStoredRemoteMcpSecret(parameter.value.trim()) : null;
      await this.pool.query(
        `INSERT INTO remote_mcp_server_parameters (remote_mcp_server_id, placement, key, value_kind, static_value, encrypted_secret_value)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [serverId, parameter.placement, parameter.key.trim(), parameter.valueKind, parameter.valueKind === 'static' ? parameter.value : null, storedSecret],
      );
    }
  }

  private async writeOAuthState(
    serverId: string,
    oauthConfig: RemoteMcpOAuthConfigRecord | null,
    oauthCredentials: RemoteMcpOAuthCredentialsRecord | null,
  ): Promise<void> {
    if (!oauthConfig && !oauthCredentials) {
      return;
    }
    await this.pool.query(
      `UPDATE remote_mcp_servers
          SET oauth_config = $2::jsonb,
              oauth_credentials = $3::jsonb,
              updated_at = now()
        WHERE id = $1`,
      [serverId, JSON.stringify(oauthConfig), JSON.stringify(oauthCredentials)],
    );
  }

  private async grantToAllExistingSpecialists(tenantId: string, serverId: string): Promise<void> {
    const result = await this.pool.query<{ id: string }>(
      `SELECT id
         FROM role_definitions
        WHERE tenant_id = $1
          AND is_active = true`,
      [tenantId],
    );
    for (const role of result.rows) {
      await this.pool.query(
        `INSERT INTO specialist_mcp_server_grants (specialist_id, remote_mcp_server_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [role.id, serverId],
      );
    }
  }

  private async assertUniqueSlug(tenantId: string, slug: string, currentId?: string): Promise<void> {
    const result = await this.pool.query<{ id: string }>(
      `SELECT id FROM remote_mcp_servers WHERE tenant_id = $1 AND slug = $2 LIMIT 1`,
      [tenantId, slug],
    );
    const row = result.rows[0];
    if (row && row.id !== currentId) {
      throw new ConflictError(`Remote MCP server name already exists`);
    }
  }
}

function listServersSql(): string {
  return `SELECT
    s.*,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id,
        'placement', p.placement,
        'key', p.key,
        'value_kind', p.value_kind,
        'static_value', p.static_value,
        'encrypted_secret_value', p.encrypted_secret_value
      ) ORDER BY p.created_at ASC)
      FROM remote_mcp_server_parameters p
      WHERE p.remote_mcp_server_id = s.id
    ), '[]'::jsonb) AS parameter_rows,
    COALESCE((SELECT COUNT(*)::integer FROM specialist_mcp_server_grants g WHERE g.remote_mcp_server_id = s.id), 0) AS assigned_specialist_count
  FROM remote_mcp_servers s
  WHERE s.tenant_id = $1`;
}

function toRemoteMcpServerRecord(row: RemoteMcpServerRow, exposeSecretValues: boolean): RemoteMcpServerRecord {
  const snapshot = Array.isArray(row.discovered_tools_snapshot) ? row.discovered_tools_snapshot as Record<string, unknown>[] : [];
  const parameterRows = Array.isArray(row.parameter_rows) ? row.parameter_rows as Array<Record<string, unknown>> : [];
  const parameters = parameterRows.map((parameter) => {
    const valueKind = parameter.value_kind === 'secret' ? 'secret' : 'static';
    const storedSecret = typeof parameter.encrypted_secret_value === 'string' ? parameter.encrypted_secret_value : '';
    const value = valueKind === 'secret'
      ? exposeSecretValues
        ? decryptRemoteMcpSecret(storedSecret)
        : 'redacted://remote-mcp-secret'
      : typeof parameter.static_value === 'string'
        ? parameter.static_value
        : '';
    return {
      id: String(parameter.id ?? ''),
      placement: String(parameter.placement ?? 'query') as RemoteMcpServerParameterRecord['placement'],
      key: String(parameter.key ?? ''),
      value_kind: valueKind as RemoteMcpServerParameterRecord['value_kind'],
      value,
      has_stored_secret: storedSecret !== '',
    };
  });
  const oauthConfig = normalizeOauthConfig(row.oauth_config);
  const oauthCredentials = normalizeOauthCredentials(row.oauth_credentials);
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    endpoint_url: row.endpoint_url,
    call_timeout_seconds: row.call_timeout_seconds,
    auth_mode: row.auth_mode as RemoteMcpServerRecord['auth_mode'],
    enabled_by_default_for_new_specialists: row.enabled_by_default_for_new_specialists,
    is_archived: row.is_archived,
    verification_status: row.verification_status as RemoteMcpServerRecord['verification_status'],
    verification_error: row.verification_error,
    verified_transport: row.verified_transport as RemoteMcpServerRecord['verified_transport'],
    verified_at: row.verified_at,
    verification_contract_version: row.verification_contract_version,
    discovered_tools_snapshot: snapshot,
    discovered_tool_count: snapshot.length,
    assigned_specialist_count: row.assigned_specialist_count ?? 0,
    parameters,
    oauth_connected: oauthCredentials !== null && !oauthCredentials.needsReauth,
    oauth_authorized_at: oauthCredentials?.authorizedAt ?? null,
    oauth_needs_reauth: oauthCredentials?.needsReauth ?? false,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...(exposeSecretValues
      ? {
          oauth_config: oauthConfig,
          oauth_credentials: oauthCredentials,
        }
      : {}),
  };
}

function normalizeOauthConfig(value: unknown): RemoteMcpOAuthConfigRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return oauthConfigSchema.parse(value);
}

function normalizeOauthCredentials(value: unknown): RemoteMcpOAuthCredentialsRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return oauthCredentialsSchema.parse(value);
}

function normalizeSlug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
}

function assertValidEndpointUrl(value: string): void {
  const parsed = new URL(value);
  if (parsed.search || parsed.hash) {
    throw new ValidationError('Remote MCP endpoint URL must not include a query string or fragment');
  }
}

function handleRemoteMcpWriteError(error: unknown): never {
  if (error instanceof Error && /uq_remote_mcp_servers_tenant_slug/i.test(error.message)) {
    throw new ConflictError('Remote MCP server name already exists');
  }
  throw error;
}
