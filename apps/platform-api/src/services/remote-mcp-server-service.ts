import { z } from 'zod';

import type { DatabaseQueryable } from '../db/database.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/domain-errors.js';
import {
  decryptRemoteMcpSecret,
  normalizeStoredRemoteMcpSecret,
} from './remote-mcp-secret-crypto.js';
import {
  remoteMcpOauthConfigSchema,
  remoteMcpOauthCredentialsSchema,
  remoteMcpOauthDefinitionSchema,
  remoteMcpParameterSchema,
  remoteMcpTransportPreferenceSchema,
  type RemoteMcpOAuthConfigRecord,
  type RemoteMcpOAuthCredentialsRecord,
  type RemoteMcpOauthDefinition,
  type RemoteMcpParameterInput,
  type RemoteMcpTransportPreference,
} from './remote-mcp-model.js';

const createVerifiedServerSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).default(''),
  endpointUrl: z.string().min(1).max(2000),
  transportPreference: remoteMcpTransportPreferenceSchema.default('auto'),
  callTimeoutSeconds: z.number().int().min(1).max(86400).default(300),
  authMode: z.enum(['none', 'parameterized', 'oauth']),
  enabledByDefaultForNewSpecialists: z.boolean().default(false),
  grantToAllExistingSpecialists: z.boolean().default(false),
  verificationStatus: z.enum(['unknown', 'verified', 'failed']),
  verificationError: z.string().nullable(),
  verifiedTransport: z.enum(['streamable_http', 'http_sse_compat']).nullable(),
  verifiedDiscoveryStrategy: z.string().nullable().default(null),
  verifiedOAuthStrategy: z.string().nullable().default(null),
  verificationContractVersion: z.string().min(1),
  verifiedCapabilitySummary: z.record(z.unknown()).default({}),
  discoveredToolsSnapshot: z.array(z.record(z.unknown())).default([]),
  discoveredResourcesSnapshot: z.array(z.record(z.unknown())).default([]),
  discoveredPromptsSnapshot: z.array(z.record(z.unknown())).default([]),
  parameters: z.array(remoteMcpParameterSchema).default([]),
  oauthDefinition: remoteMcpOauthDefinitionSchema.nullable().optional(),
  oauthConfig: remoteMcpOauthConfigSchema.nullable().optional(),
  oauthCredentials: remoteMcpOauthCredentialsSchema.nullable().optional(),
}).strict();

const updateVerifiedServerSchema = createVerifiedServerSchema.partial().extend({
  endpointUrl: z.string().min(1).max(2000).optional(),
}).strict();

export type CreateVerifiedRemoteMcpServerInput = z.input<typeof createVerifiedServerSchema>;
export type UpdateVerifiedRemoteMcpServerInput = z.input<typeof updateVerifiedServerSchema>;

interface RemoteMcpServerRow {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  description: string;
  endpoint_url: string;
  transport_preference: string;
  call_timeout_seconds: number;
  auth_mode: string;
  enabled_by_default_for_new_specialists: boolean;
  is_archived: boolean;
  verification_status: string;
  verification_error: string | null;
  verified_transport: string | null;
  verified_discovery_strategy: string | null;
  verified_oauth_strategy: string | null;
  verified_at: Date | null;
  verification_contract_version: string;
  verified_capability_summary: unknown;
  discovered_tools_snapshot: unknown;
  discovered_resources_snapshot: unknown;
  discovered_prompts_snapshot: unknown;
  oauth_definition: unknown;
  oauth_config: unknown;
  oauth_credentials: unknown;
  created_at: Date;
  updated_at: Date;
  parameter_rows?: unknown;
  assigned_specialist_count?: number;
}

export interface RemoteMcpServerParameterRecord {
  id: string;
  placement: RemoteMcpParameterInput['placement'];
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
  transport_preference: RemoteMcpTransportPreference;
  call_timeout_seconds: number;
  auth_mode: 'none' | 'parameterized' | 'oauth';
  enabled_by_default_for_new_specialists: boolean;
  is_archived: boolean;
  verification_status: 'unknown' | 'verified' | 'failed';
  verification_error: string | null;
  verified_transport: 'streamable_http' | 'http_sse_compat' | null;
  verified_discovery_strategy: string | null;
  verified_oauth_strategy: string | null;
  verified_at: Date | null;
  verification_contract_version: string;
  verified_capability_summary: Record<string, unknown>;
  discovered_tools_snapshot: Record<string, unknown>[];
  discovered_resources_snapshot: Record<string, unknown>[];
  discovered_prompts_snapshot: Record<string, unknown>[];
  discovered_tool_count: number;
  discovered_resource_count: number;
  discovered_prompt_count: number;
  assigned_specialist_count: number;
  parameters: RemoteMcpServerParameterRecord[];
  oauth_definition: RemoteMcpOauthDefinition | null;
  oauth_connected: boolean;
  oauth_authorized_at: string | null;
  oauth_needs_reauth: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface StoredRemoteMcpServerRecord extends RemoteMcpServerRecord {
  oauth_definition: RemoteMcpOauthDefinition | null;
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
         tenant_id, name, slug, description, endpoint_url, transport_preference, call_timeout_seconds, auth_mode,
         enabled_by_default_for_new_specialists, verification_status, verification_error,
         verified_transport, verified_discovery_strategy, verified_oauth_strategy, verified_at,
         verification_contract_version, verified_capability_summary, discovered_tools_snapshot,
         discovered_resources_snapshot, discovered_prompts_snapshot, oauth_definition
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18::jsonb, $19::jsonb, $20::jsonb, $21::jsonb)
       RETURNING id`,
      [
        tenantId,
        validated.name.trim(),
        normalizeSlug(validated.name),
        validated.description.trim(),
        validated.endpointUrl.trim(),
        validated.transportPreference,
        validated.callTimeoutSeconds,
        validated.authMode,
        validated.enabledByDefaultForNewSpecialists,
        validated.verificationStatus,
        validated.verificationError,
        validated.verifiedTransport,
        validated.verifiedDiscoveryStrategy,
        validated.verifiedOAuthStrategy,
        validated.verificationStatus === 'verified' ? new Date() : null,
        validated.verificationContractVersion,
        JSON.stringify(validated.verifiedCapabilitySummary),
        JSON.stringify(validated.discoveredToolsSnapshot),
        JSON.stringify(validated.discoveredResourcesSnapshot),
        JSON.stringify(validated.discoveredPromptsSnapshot),
        JSON.stringify(persistableOauthDefinition(validated.oauthDefinition ?? null)),
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
              transport_preference = $7,
              call_timeout_seconds = $8,
              auth_mode = $9,
              enabled_by_default_for_new_specialists = $10,
              verification_status = $11,
              verification_error = $12,
              verified_transport = $13,
              verified_discovery_strategy = $14,
              verified_oauth_strategy = $15,
              verified_at = $16,
              verification_contract_version = $17,
              verified_capability_summary = $18::jsonb,
              discovered_tools_snapshot = $19::jsonb,
              discovered_resources_snapshot = $20::jsonb,
              discovered_prompts_snapshot = $21::jsonb,
              oauth_definition = $22::jsonb,
              oauth_config = $23::jsonb,
              oauth_credentials = $24::jsonb,
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
        validated.transportPreference ?? current.transport_preference,
        validated.callTimeoutSeconds ?? current.call_timeout_seconds,
        validated.authMode ?? current.auth_mode,
        validated.enabledByDefaultForNewSpecialists ?? current.enabled_by_default_for_new_specialists,
        validated.verificationStatus ?? current.verification_status,
        validated.verificationError ?? current.verification_error,
        validated.verifiedTransport ?? current.verified_transport,
        validated.verifiedDiscoveryStrategy ?? current.verified_discovery_strategy,
        validated.verifiedOAuthStrategy ?? current.verified_oauth_strategy,
        (validated.verificationStatus ?? current.verification_status) === 'verified' ? new Date() : null,
        validated.verificationContractVersion ?? current.verification_contract_version,
        JSON.stringify(validated.verifiedCapabilitySummary ?? current.verified_capability_summary),
        JSON.stringify(validated.discoveredToolsSnapshot ?? current.discovered_tools_snapshot),
        JSON.stringify(validated.discoveredResourcesSnapshot ?? current.discovered_resources_snapshot),
        JSON.stringify(validated.discoveredPromptsSnapshot ?? current.discovered_prompts_snapshot),
        JSON.stringify(persistableOauthDefinition(validated.oauthDefinition ?? current.oauth_definition)),
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
    input: Pick<CreateVerifiedRemoteMcpServerInput, 'verificationStatus' | 'verificationError' | 'verifiedTransport' | 'verifiedDiscoveryStrategy' | 'verifiedOAuthStrategy' | 'verificationContractVersion' | 'verifiedCapabilitySummary' | 'discoveredToolsSnapshot' | 'discoveredResourcesSnapshot' | 'discoveredPromptsSnapshot'>,
  ): Promise<RemoteMcpServerRecord> {
    await this.pool.query(
      `UPDATE remote_mcp_servers
          SET verification_status = $3,
              verification_error = $4,
              verified_transport = $5,
              verified_discovery_strategy = $6,
              verified_oauth_strategy = $7,
              verified_at = $8,
              verification_contract_version = $9,
              verified_capability_summary = $10::jsonb,
              discovered_tools_snapshot = $11::jsonb,
              discovered_resources_snapshot = $12::jsonb,
              discovered_prompts_snapshot = $13::jsonb,
              updated_at = now()
        WHERE tenant_id = $1
          AND id = $2`,
      [
        tenantId,
        id,
        input.verificationStatus,
        input.verificationError,
        input.verifiedTransport,
        input.verifiedDiscoveryStrategy,
        input.verifiedOAuthStrategy,
        input.verificationStatus === 'verified' ? new Date() : null,
        input.verificationContractVersion,
        JSON.stringify(input.verifiedCapabilitySummary),
        JSON.stringify(input.discoveredToolsSnapshot),
        JSON.stringify(input.discoveredResourcesSnapshot),
        JSON.stringify(input.discoveredPromptsSnapshot),
      ],
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

  private async replaceParameters(serverId: string, parameters: RemoteMcpParameterInput[]): Promise<void> {
    await this.pool.query('DELETE FROM remote_mcp_server_parameters WHERE remote_mcp_server_id = $1', [serverId]);
    for (const [sortOrder, parameter] of parameters.entries()) {
      const storedSecret = parameter.valueKind === 'secret' ? normalizeStoredRemoteMcpSecret(parameter.value.trim()) : null;
      await this.pool.query(
        `INSERT INTO remote_mcp_server_parameters (remote_mcp_server_id, placement, key, value_kind, static_value, encrypted_secret_value, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          serverId,
          parameter.placement,
          parameter.key.trim(),
          parameter.valueKind,
          parameter.valueKind === 'static' ? parameter.value : null,
          storedSecret,
          sortOrder,
        ],
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
      ) ORDER BY p.sort_order ASC, p.created_at ASC)
      FROM remote_mcp_server_parameters p
      WHERE p.remote_mcp_server_id = s.id
    ), '[]'::jsonb) AS parameter_rows,
    COALESCE((SELECT COUNT(*)::integer FROM specialist_mcp_server_grants g WHERE g.remote_mcp_server_id = s.id), 0) AS assigned_specialist_count
  FROM remote_mcp_servers s
  WHERE s.tenant_id = $1`;
}

function toRemoteMcpServerRecord(row: RemoteMcpServerRow, exposeSecretValues: boolean): RemoteMcpServerRecord {
  const snapshot = Array.isArray(row.discovered_tools_snapshot) ? row.discovered_tools_snapshot as Record<string, unknown>[] : [];
  const resourcesSnapshot = Array.isArray(row.discovered_resources_snapshot) ? row.discovered_resources_snapshot as Record<string, unknown>[] : [];
  const promptsSnapshot = Array.isArray(row.discovered_prompts_snapshot) ? row.discovered_prompts_snapshot as Record<string, unknown>[] : [];
  const capabilitySummary = isRecord(row.verified_capability_summary) ? row.verified_capability_summary : {};
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
    transport_preference: readTransportPreference(row.transport_preference),
    call_timeout_seconds: row.call_timeout_seconds,
    auth_mode: row.auth_mode as RemoteMcpServerRecord['auth_mode'],
    enabled_by_default_for_new_specialists: row.enabled_by_default_for_new_specialists,
    is_archived: row.is_archived,
    verification_status: row.verification_status as RemoteMcpServerRecord['verification_status'],
    verification_error: row.verification_error,
    verified_transport: row.verified_transport as RemoteMcpServerRecord['verified_transport'],
    verified_discovery_strategy: typeof row.verified_discovery_strategy === 'string' ? row.verified_discovery_strategy : null,
    verified_oauth_strategy: typeof row.verified_oauth_strategy === 'string' ? row.verified_oauth_strategy : null,
    verified_at: row.verified_at,
    verification_contract_version: row.verification_contract_version,
    verified_capability_summary: capabilitySummary,
    discovered_tools_snapshot: snapshot,
    discovered_resources_snapshot: resourcesSnapshot,
    discovered_prompts_snapshot: promptsSnapshot,
    discovered_tool_count: snapshot.length,
    discovered_resource_count: resourcesSnapshot.length,
    discovered_prompt_count: promptsSnapshot.length,
    assigned_specialist_count: row.assigned_specialist_count ?? 0,
    parameters,
    oauth_definition: normalizeOauthDefinition(row.oauth_definition, exposeSecretValues),
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
  return remoteMcpOauthConfigSchema.parse(value);
}

function normalizeOauthCredentials(value: unknown): RemoteMcpOAuthCredentialsRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return remoteMcpOauthCredentialsSchema.parse(value);
}

function normalizeOauthDefinition(
  value: unknown,
  exposeSecretValues: boolean,
): RemoteMcpOauthDefinition | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const parsed = remoteMcpOauthDefinitionSchema.parse(value);
  if (exposeSecretValues) {
    return {
      ...parsed,
      clientSecret: parsed.clientSecret ? decryptRemoteMcpSecret(parsed.clientSecret) : null,
      privateKeyPem: parsed.privateKeyPem ? decryptRemoteMcpSecret(parsed.privateKeyPem) : null,
    };
  }
  return {
    ...parsed,
    clientSecret: parsed.clientSecret ? 'redacted://remote-mcp-secret' : null,
    privateKeyPem: parsed.privateKeyPem ? 'redacted://remote-mcp-secret' : null,
  };
}

function persistableOauthDefinition(
  value: RemoteMcpOauthDefinition | null,
): RemoteMcpOauthDefinition | null {
  if (!value) {
    return null;
  }
  return {
    ...value,
    clientSecret: value.clientSecret ? normalizeStoredRemoteMcpSecret(value.clientSecret) : null,
    privateKeyPem: value.privateKeyPem ? normalizeStoredRemoteMcpSecret(value.privateKeyPem) : null,
  };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readTransportPreference(value: unknown): RemoteMcpTransportPreference {
  if (value === 'streamable_http' || value === 'http_sse_compat') {
    return value;
  }
  return 'auto';
}
