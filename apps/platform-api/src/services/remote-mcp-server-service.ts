import { z } from 'zod';

import type { DatabaseQueryable } from '../db/database.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/domain-errors.js';
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
} from './remote-mcp-model.js';
import {
  assertValidEndpointUrl,
  handleRemoteMcpWriteError,
  listServersSql,
  normalizeSlug,
  toRemoteMcpServerRecord,
} from './remote-mcp/remote-mcp-server-records.js';
import type {
  RemoteMcpServerParameterRecord,
  RemoteMcpServerRecord,
  RemoteMcpServerRow,
  StoredRemoteMcpServerRecord,
} from './remote-mcp/remote-mcp-server-types.js';
import {
  persistOauthDefinitionSecrets,
  resolvePersistedOauthDefinition,
  resolvePersistedParameterSecret,
} from './remote-mcp-server-secrets.js';

const createVerifiedServerSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).default(''),
  endpointUrl: z.string().min(1).max(2000),
  transportPreference: remoteMcpTransportPreferenceSchema.default('auto'),
  callTimeoutSeconds: z.number().int().min(1).max(86400).default(300),
  authMode: z.enum(['none', 'parameterized', 'oauth']),
  enabledByDefaultForNewSpecialists: z.boolean().default(false),
  grantToAllExistingSpecialists: z.boolean().default(false),
  oauthClientProfileId: z.string().uuid().nullable().optional(),
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
export type {
  RemoteMcpServerParameterRecord,
  RemoteMcpServerRecord,
  StoredRemoteMcpServerRecord,
} from './remote-mcp/remote-mcp-server-types.js';

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
    await this.assertOauthClientProfileExists(tenantId, validated.oauthClientProfileId ?? null);
    const insert = await this.pool.query<{ id: string }>(
        `INSERT INTO remote_mcp_servers (
         tenant_id, name, slug, description, endpoint_url, transport_preference, call_timeout_seconds, auth_mode,
         enabled_by_default_for_new_specialists, oauth_client_profile_id, verification_status, verification_error,
         verified_transport, verified_discovery_strategy, verified_oauth_strategy, verified_at,
         verification_contract_version, verified_capability_summary, discovered_tools_snapshot,
         discovered_resources_snapshot, discovered_prompts_snapshot, oauth_definition
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb, $19::jsonb, $20::jsonb, $21::jsonb, $22::jsonb)
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
        validated.oauthClientProfileId ?? null,
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
        JSON.stringify(persistOauthDefinitionSecrets(validated.oauthDefinition ?? null, null)),
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
    const oauthClientProfileId =
      validated.oauthClientProfileId === undefined
        ? current.oauth_client_profile_id
        : validated.oauthClientProfileId;
    await this.assertOauthClientProfileExists(tenantId, oauthClientProfileId ?? null);
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
              oauth_client_profile_id = $11,
              verification_status = $12,
              verification_error = $13,
              verified_transport = $14,
              verified_discovery_strategy = $15,
              verified_oauth_strategy = $16,
              verified_at = $17,
              verification_contract_version = $18,
              verified_capability_summary = $19::jsonb,
              discovered_tools_snapshot = $20::jsonb,
              discovered_resources_snapshot = $21::jsonb,
              discovered_prompts_snapshot = $22::jsonb,
              oauth_definition = $23::jsonb,
              oauth_config = $24::jsonb,
              oauth_credentials = $25::jsonb,
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
        oauthClientProfileId,
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
        JSON.stringify(resolvePersistedOauthDefinition(validated.oauthDefinition, current.oauth_definition)),
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
    const currentSecrets = await this.loadCurrentParameterSecrets(serverId);
    await this.pool.query('DELETE FROM remote_mcp_server_parameters WHERE remote_mcp_server_id = $1', [serverId]);
    for (const [sortOrder, parameter] of parameters.entries()) {
      const storedSecret = resolvePersistedParameterSecret(parameter, currentSecrets);
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

  private async loadCurrentParameterSecrets(serverId: string): Promise<Map<string, string>> {
    const result = await this.pool.query<{
      id: string;
      encrypted_secret_value: string | null;
    }>(
      `SELECT id, encrypted_secret_value
         FROM remote_mcp_server_parameters
        WHERE remote_mcp_server_id = $1`,
      [serverId],
    );
    return new Map(
      result.rows.flatMap((row) =>
        typeof row.encrypted_secret_value === 'string' && row.encrypted_secret_value.trim().length > 0
          ? [[row.id, row.encrypted_secret_value]]
          : [],
      ),
    );
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

  private async assertOauthClientProfileExists(tenantId: string, profileId: string | null): Promise<void> {
    if (!profileId) {
      return;
    }
    const result = await this.pool.query<{ id: string }>(
      `SELECT id FROM remote_mcp_oauth_client_profiles WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
      [tenantId, profileId],
    );
    if (!result.rows[0]) {
      throw new ValidationError('Remote MCP OAuth client profile not found');
    }
  }
}
