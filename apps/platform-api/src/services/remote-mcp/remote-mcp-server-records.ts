import { ConflictError, ValidationError } from '../../errors/domain-errors.js';
import { decryptRemoteMcpSecret } from './core/remote-mcp-secret-crypto.js';
import {
  remoteMcpOauthConfigSchema,
  remoteMcpOauthCredentialsSchema,
  remoteMcpOauthDefinitionSchema,
  type RemoteMcpOAuthConfigRecord,
  type RemoteMcpOAuthCredentialsRecord,
  type RemoteMcpOauthDefinition,
  type RemoteMcpTransportPreference,
} from './core/remote-mcp-model.js';
import type {
  RemoteMcpServerParameterRecord,
  RemoteMcpServerRecord,
  RemoteMcpServerRow,
} from './remote-mcp-server-types.js';

export function listServersSql(): string {
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
    cp.name AS oauth_client_profile_name,
    COALESCE((SELECT COUNT(*)::integer FROM specialist_mcp_server_grants g WHERE g.remote_mcp_server_id = s.id), 0) AS assigned_specialist_count
  FROM remote_mcp_servers s
  LEFT JOIN remote_mcp_oauth_client_profiles cp
    ON cp.id = s.oauth_client_profile_id
  WHERE s.tenant_id = $1`;
}

export function toRemoteMcpServerRecord(
  row: RemoteMcpServerRow,
  exposeSecretValues: boolean,
): RemoteMcpServerRecord {
  const snapshot = Array.isArray(row.discovered_tools_snapshot)
    ? row.discovered_tools_snapshot as Record<string, unknown>[]
    : [];
  const resourcesSnapshot = Array.isArray(row.discovered_resources_snapshot)
    ? row.discovered_resources_snapshot as Record<string, unknown>[]
    : [];
  const promptsSnapshot = Array.isArray(row.discovered_prompts_snapshot)
    ? row.discovered_prompts_snapshot as Record<string, unknown>[]
    : [];
  const capabilitySummary = isRecord(row.verified_capability_summary)
    ? row.verified_capability_summary
    : {};
  const parameterRows = Array.isArray(row.parameter_rows)
    ? row.parameter_rows as Array<Record<string, unknown>>
    : [];
  const parameters = parameterRows.map((parameter) => {
    const valueKind = parameter.value_kind === 'secret' ? 'secret' : 'static';
    const storedSecret =
      typeof parameter.encrypted_secret_value === 'string'
        ? parameter.encrypted_secret_value
        : '';
    return {
      id: String(parameter.id ?? ''),
      placement: String(parameter.placement ?? 'query') as RemoteMcpServerParameterRecord['placement'],
      key: String(parameter.key ?? ''),
      value_kind: valueKind as RemoteMcpServerParameterRecord['value_kind'],
      value: resolveParameterValue(parameter, valueKind, storedSecret, exposeSecretValues),
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
    verified_discovery_strategy:
      typeof row.verified_discovery_strategy === 'string' ? row.verified_discovery_strategy : null,
    verified_oauth_strategy:
      typeof row.verified_oauth_strategy === 'string' ? row.verified_oauth_strategy : null,
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
    oauth_client_profile_id: row.oauth_client_profile_id ?? null,
    oauth_client_profile_name:
      typeof row.oauth_client_profile_name === 'string' ? row.oauth_client_profile_name : null,
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

export function normalizeSlug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
}

export function assertValidEndpointUrl(value: string): void {
  const parsed = new URL(value);
  if (parsed.search || parsed.hash) {
    throw new ValidationError('Remote MCP endpoint URL must not include a query string or fragment');
  }
}

export function handleRemoteMcpWriteError(error: unknown): never {
  if (error instanceof Error && /uq_remote_mcp_servers_tenant_slug/i.test(error.message)) {
    throw new ConflictError('Remote MCP server name already exists');
  }
  throw error;
}

function resolveParameterValue(
  parameter: Record<string, unknown>,
  valueKind: 'static' | 'secret',
  storedSecret: string,
  exposeSecretValues: boolean,
): string {
  if (valueKind === 'static') {
    return typeof parameter.static_value === 'string' ? parameter.static_value : '';
  }
  return exposeSecretValues
    ? decryptRemoteMcpSecret(storedSecret)
    : 'redacted://remote-mcp-secret';
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readTransportPreference(value: unknown): RemoteMcpTransportPreference {
  if (value === 'streamable_http' || value === 'http_sse_compat') {
    return value;
  }
  return 'auto';
}
