import type { DatabaseQueryable } from '../db/database.js';

export interface SpecialistSkillCapability {
  id: string;
  name: string;
  slug: string;
  summary: string | null;
  content: string;
  sortOrder: number;
}

export interface SpecialistMcpParameterCapability {
  id: string;
  placement:
    | 'path'
    | 'query'
    | 'header'
    | 'cookie'
    | 'initialize_param'
    | 'authorize_request_query'
    | 'token_request_header'
    | 'token_request_body_form'
    | 'token_request_body_json';
  key: string;
  valueKind: 'static' | 'secret';
  staticValue: string | null;
  encryptedSecretValue: string | null;
}

export interface SpecialistRemoteMcpServerCapability {
  id: string;
  name: string;
  slug: string;
  description: string;
  endpointUrl: string;
  callTimeoutSeconds: number;
  authMode: 'none' | 'parameterized' | 'oauth';
  verifiedTransport: 'streamable_http' | 'http_sse_compat' | null;
  verificationContractVersion: string;
  verifiedCapabilitySummary: Record<string, unknown>;
  discoveredToolsSnapshot: Array<Record<string, unknown>>;
  discoveredResourcesSnapshot: Array<Record<string, unknown>>;
  discoveredPromptsSnapshot: Array<Record<string, unknown>>;
  parameters: SpecialistMcpParameterCapability[];
  oauthConfig: SpecialistRemoteMcpOAuthConfigCapability | null;
  oauthCredentials: SpecialistRemoteMcpOAuthCredentialsCapability | null;
}

export interface SpecialistRemoteMcpOAuthConfigCapability {
  issuer: string | null;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string | null;
  deviceAuthorizationEndpoint: string | null;
  clientId: string;
  clientSecret: string | null;
  tokenEndpointAuthMethod: 'none' | 'client_secret_post' | 'client_secret_basic' | 'private_key_jwt';
  clientIdMetadataDocumentUrl: string | null;
  redirectUri: string;
  scopes: string[];
  resource: string;
  resourceIndicators: string[];
  audiences: string[];
}

export interface SpecialistRemoteMcpOAuthCredentialsCapability {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  tokenType: string | null;
  scope: string | null;
  authorizedAt: string;
  authorizedByUserId: string;
  needsReauth: boolean;
}

export interface SpecialistRoleCapabilities {
  name: string;
  description: string | null;
  escalationTarget: string | null;
  allowedTools: string[];
  skills: SpecialistSkillCapability[];
  remoteMcpServers: SpecialistRemoteMcpServerCapability[];
}

interface CapabilityQueryRow {
  name: string;
  description: string | null;
  escalation_target: string | null;
  allowed_tools: unknown;
  skills: unknown;
  remote_mcp_servers: unknown;
}

export class SpecialistCapabilityService {
  constructor(private readonly pool: DatabaseQueryable) {}

  getRoleCapabilities(
    tenantId: string,
    roleName: string,
  ): Promise<SpecialistRoleCapabilities | null> {
    return readSpecialistRoleCapabilities(this.pool, tenantId, roleName);
  }
}

export async function readSpecialistRoleCapabilities(
  db: DatabaseQueryable,
  tenantId: string,
  roleName: string,
): Promise<SpecialistRoleCapabilities | null> {
  const result = await db.query<CapabilityQueryRow>(
    `SELECT
       rd.name,
       rd.description,
       rd.escalation_target,
       rd.allowed_tools,
       COALESCE((
         SELECT jsonb_agg(jsonb_build_object(
           'id', s.id,
           'name', s.name,
           'slug', s.slug,
           'summary', s.summary,
           'content', s.content,
           'sort_order', a.sort_order
         ) ORDER BY a.sort_order ASC)
           FROM specialist_skill_assignments a
           JOIN specialist_skills s
             ON s.id = a.skill_id
          WHERE a.specialist_id = rd.id
            AND s.is_archived = false
       ), '[]'::jsonb) AS skills,
       COALESCE((
         SELECT jsonb_agg(jsonb_build_object(
           'id', s.id,
           'name', s.name,
           'slug', s.slug,
           'description', s.description,
           'endpoint_url', s.endpoint_url,
           'call_timeout_seconds', s.call_timeout_seconds,
           'auth_mode', s.auth_mode,
           'verified_transport', s.verified_transport,
           'verification_contract_version', s.verification_contract_version,
           'verified_capability_summary', s.verified_capability_summary,
           'discovered_tools_snapshot', s.discovered_tools_snapshot,
           'discovered_resources_snapshot', s.discovered_resources_snapshot,
           'discovered_prompts_snapshot', s.discovered_prompts_snapshot,
           'oauth_config', s.oauth_config,
           'oauth_credentials', s.oauth_credentials,
           'parameters', COALESCE((
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
           ), '[]'::jsonb)
         ) ORDER BY s.name ASC)
           FROM specialist_mcp_server_grants g
           JOIN remote_mcp_servers s
             ON s.id = g.remote_mcp_server_id
          WHERE g.specialist_id = rd.id
            AND s.is_archived = false
            AND s.verification_status = 'verified'
       ), '[]'::jsonb) AS remote_mcp_servers
      FROM role_definitions rd
     WHERE rd.tenant_id = $1
       AND rd.name = $2
       AND rd.is_active = true
     LIMIT 1`,
    [tenantId, roleName.trim()],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    name: row.name,
    description: row.description,
    escalationTarget: row.escalation_target,
    allowedTools: normalizeStringArray(row.allowed_tools),
    skills: normalizeSkillCapabilities(row.skills),
    remoteMcpServers: normalizeRemoteMcpServers(row.remote_mcp_servers),
  };
}

export function buildSpecialistSkillInstructionSection(
  skills: SpecialistSkillCapability[],
): string | null {
  if (skills.length === 0) {
    return null;
  }
  const lines = ['## Specialist Skills'];
  for (const skill of skills) {
    lines.push(`### ${skill.name}`);
    if (skill.summary) {
      lines.push(skill.summary);
    }
    lines.push(skill.content);
  }
  return lines.join('\n');
}

export function buildRemoteMcpAvailabilitySection(
  servers: SpecialistRemoteMcpServerCapability[],
): string | null {
  if (servers.length === 0) {
    return null;
  }
  const lines = ['## Remote MCP Servers Available'];
  for (const server of servers) {
    const capabilitySummary = formatRemoteMcpCapabilitySummary(server.verifiedCapabilitySummary);
    lines.push(`- ${server.name}: ${server.description || 'Remote MCP server.'} ${capabilitySummary}`);
  }
  return lines.join('\n');
}

export function summarizeRemoteMcpToolNames(
  tools: Array<Record<string, unknown>>,
): string[] {
  const names = tools.flatMap((tool) => {
    const originalName = readString(tool.original_name);
    if (originalName) {
      return [originalName];
    }
    const name = readString(tool.name);
    return name ? [name] : [];
  });
  return Array.from(new Set(names));
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => (typeof entry === 'string' ? [entry] : []))
    : [];
}

function normalizeSkillCapabilities(value: unknown): SpecialistSkillCapability[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (!isRecord(entry)) {
      return [];
    }
    const id = readString(entry.id);
    const name = readString(entry.name);
    const slug = readString(entry.slug);
    const content = readString(entry.content);
    if (!id || !name || !slug || !content) {
      return [];
    }
    return [{
      id,
      name,
      slug,
      summary: readString(entry.summary),
      content,
      sortOrder: readNumber(entry.sort_order) ?? 0,
    }];
  });
}

function normalizeRemoteMcpServers(value: unknown): SpecialistRemoteMcpServerCapability[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (!isRecord(entry)) {
      return [];
    }
    const id = readString(entry.id);
    const name = readString(entry.name);
    const slug = readString(entry.slug);
    const endpointUrl = readString(entry.endpoint_url);
    const verificationContractVersion = readString(entry.verification_contract_version);
    if (!id || !name || !slug || !endpointUrl || !verificationContractVersion) {
      return [];
    }
    return [{
      id,
      name,
      slug,
      description: readString(entry.description) ?? '',
      endpointUrl,
      callTimeoutSeconds: readPositiveInteger(entry.call_timeout_seconds) ?? 300,
      authMode: readAuthMode(entry.auth_mode),
      verifiedTransport: readTransport(entry.verified_transport),
      verificationContractVersion,
      verifiedCapabilitySummary: normalizeCapabilitySummary(entry.verified_capability_summary),
      discoveredToolsSnapshot: normalizeToolSnapshot(entry.discovered_tools_snapshot),
      discoveredResourcesSnapshot: normalizeSnapshot(entry.discovered_resources_snapshot),
      discoveredPromptsSnapshot: normalizeSnapshot(entry.discovered_prompts_snapshot),
      parameters: normalizeRemoteMcpParameters(entry.parameters),
      oauthConfig: normalizeRemoteMcpOauthConfig(entry.oauth_config),
      oauthCredentials: normalizeRemoteMcpOauthCredentials(entry.oauth_credentials),
    }];
  });
}

function normalizeRemoteMcpParameters(value: unknown): SpecialistMcpParameterCapability[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (!isRecord(entry)) {
      return [];
    }
    const id = readString(entry.id);
    const key = readString(entry.key);
    const placement = readPlacement(entry.placement);
    if (!id || !key || !placement) {
      return [];
    }
    return [{
      id,
      placement,
      key,
      valueKind: entry.value_kind === 'secret' ? 'secret' : 'static',
      staticValue: readString(entry.static_value),
      encryptedSecretValue: readString(entry.encrypted_secret_value),
    }];
  });
}

function normalizeToolSnapshot(value: unknown): Array<Record<string, unknown>> {
  return normalizeSnapshot(value);
}

function normalizeSnapshot(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.flatMap((entry) => (isRecord(entry) ? [entry] : []))
    : [];
}

function normalizeCapabilitySummary(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function formatRemoteMcpCapabilitySummary(value: Record<string, unknown>): string {
  const toolCount = readNonNegativeInteger(value.tool_count);
  const resourceCount = readNonNegativeInteger(value.resource_count);
  const promptCount = readNonNegativeInteger(value.prompt_count);
  const parts = [
    `${toolCount} tool${toolCount === 1 ? '' : 's'}`,
    `${resourceCount} resource${resourceCount === 1 ? '' : 's'}`,
    `${promptCount} prompt${promptCount === 1 ? '' : 's'}`,
  ];
  return `Verified capabilities: ${parts.join(', ')}.`;
}

function normalizeRemoteMcpOauthConfig(value: unknown): SpecialistRemoteMcpOAuthConfigCapability | null {
  if (!isRecord(value)) {
    return null;
  }
  const authorizationEndpoint = readString(value.authorizationEndpoint);
  const tokenEndpoint = readString(value.tokenEndpoint);
  const clientId = readString(value.clientId);
  const redirectUri = readString(value.redirectUri);
  const resource = readString(value.resource);
  if (!authorizationEndpoint || !tokenEndpoint || !clientId || !redirectUri || !resource) {
    return null;
  }
    return {
      issuer: readString(value.issuer),
      authorizationEndpoint,
      tokenEndpoint,
      registrationEndpoint: readString(value.registrationEndpoint),
      deviceAuthorizationEndpoint: readString(value.deviceAuthorizationEndpoint),
      clientId,
      clientSecret: readString(value.clientSecret),
      tokenEndpointAuthMethod: readOauthAuthMethod(value.tokenEndpointAuthMethod),
      clientIdMetadataDocumentUrl: readString(value.clientIdMetadataDocumentUrl),
      redirectUri,
      scopes: normalizeStringArray(value.scopes),
      resource,
      resourceIndicators: normalizeStringArray(value.resourceIndicators),
      audiences: normalizeStringArray(value.audiences),
    };
  }

function normalizeRemoteMcpOauthCredentials(value: unknown): SpecialistRemoteMcpOAuthCredentialsCapability | null {
  if (!isRecord(value)) {
    return null;
  }
  const accessToken = readString(value.accessToken);
  const authorizedAt = readString(value.authorizedAt);
  const authorizedByUserId = readString(value.authorizedByUserId);
  if (!accessToken || !authorizedAt || !authorizedByUserId) {
    return null;
  }
  return {
    accessToken,
    refreshToken: readString(value.refreshToken),
    expiresAt: readNumber(value.expiresAt),
    tokenType: readString(value.tokenType),
    scope: readString(value.scope),
    authorizedAt,
    authorizedByUserId,
    needsReauth: value.needsReauth === true,
  };
}

function readAuthMode(
  value: unknown,
): SpecialistRemoteMcpServerCapability['authMode'] {
  if (value === 'oauth' || value === 'parameterized') {
    return value;
  }
  return 'none';
}

function readTransport(
  value: unknown,
): SpecialistRemoteMcpServerCapability['verifiedTransport'] {
  return value === 'http_sse_compat' ? 'http_sse_compat' : value === 'streamable_http' ? 'streamable_http' : null;
}

function readOauthAuthMethod(
  value: unknown,
): SpecialistRemoteMcpOAuthConfigCapability['tokenEndpointAuthMethod'] {
  return value === 'client_secret_post'
    || value === 'client_secret_basic'
    || value === 'private_key_jwt'
    ? value
    : 'none';
}

function readPlacement(
  value: unknown,
): SpecialistMcpParameterCapability['placement'] | null {
  if (
    value === 'path'
    || value === 'query'
    || value === 'header'
    || value === 'cookie'
    || value === 'initialize_param'
    || value === 'authorize_request_query'
    || value === 'token_request_header'
    || value === 'token_request_body_form'
    || value === 'token_request_body_json'
  ) {
    return value;
  }
  return null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readPositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function readNonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
