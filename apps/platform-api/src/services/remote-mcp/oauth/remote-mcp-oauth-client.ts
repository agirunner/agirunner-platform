import { ValidationError } from '../../../errors/domain-errors.js';
import { assertClientSecretAuthMethod } from './remote-mcp-oauth-client-auth.js';
import type {
  RemoteMcpOAuthConfigRecord,
  RemoteMcpOauthDefinition,
} from '../core/remote-mcp-model.js';
import type { AuthorizationServerMetadata } from './remote-mcp-oauth-discovery.js';
import { readMissingTokenEndpointMessage } from '../core/remote-mcp-oauth-errors.js';
import { buildClientMetadataUrl } from './remote-mcp-oauth-discovery.js';
import { encryptRemoteMcpSecret } from '../core/remote-mcp-secret-crypto.js';

export async function buildOauthClientConfig(input: {
  metadata: AuthorizationServerMetadata;
  resource: string;
  redirectUri: string;
  oauthDefinition: RemoteMcpOauthDefinition | null;
  platformPublicBaseUrl: string;
  fetcher?: typeof fetch;
}): Promise<RemoteMcpOAuthConfigRecord> {
  const scopes = normalizeStringList(input.oauthDefinition?.scopes);
  const resourceIndicators = normalizeStringList(input.oauthDefinition?.resourceIndicators);
  const audiences = normalizeStringList(input.oauthDefinition?.audiences);
  const authorizationEndpoint =
    input.oauthDefinition?.authorizationEndpointOverride
    ?? input.metadata.authorizationEndpoint
    ?? null;
  const tokenEndpoint =
    input.oauthDefinition?.tokenEndpointOverride
    ?? input.metadata.tokenEndpoint;
  const registrationEndpoint =
    input.oauthDefinition?.registrationEndpointOverride
    ?? input.metadata.registrationEndpoint;
  const deviceAuthorizationEndpoint =
    input.oauthDefinition?.deviceAuthorizationEndpointOverride
    ?? input.metadata.deviceAuthorizationEndpoint;

  if (!tokenEndpoint) {
    throw new ValidationError(readMissingTokenEndpointMessage(input.oauthDefinition));
  }

  if (input.oauthDefinition?.clientStrategy === 'manual_client'
    || readString(input.oauthDefinition?.clientId) !== null) {
    const clientId = readString(input.oauthDefinition?.clientId);
    if (!clientId) {
      throw new ValidationError('Remote MCP OAuth manual client strategy requires a client id');
    }
    const tokenEndpointAuthMethod = input.oauthDefinition?.tokenEndpointAuthMethod ?? 'none';
    assertClientSecretAuthMethod({
      clientSecret: input.oauthDefinition?.clientSecret ?? null,
      tokenEndpointAuthMethod,
    });
    return {
      issuer: input.metadata.issuer,
      authorizationEndpoint,
      tokenEndpoint,
      registrationEndpoint,
      deviceAuthorizationEndpoint,
      clientId,
      clientSecret: encryptOptionalSecret(input.oauthDefinition?.clientSecret),
      tokenEndpointAuthMethod,
      clientIdMetadataDocumentUrl: null,
      redirectUri: input.redirectUri,
      scopes,
      resource: input.resource,
      resourceIndicators,
      audiences,
    };
  }

  if (input.metadata.clientIdMetadataDocumentSupported) {
    const clientMetadataUrl = buildClientMetadataUrl(input.platformPublicBaseUrl);
    return {
      issuer: input.metadata.issuer,
      authorizationEndpoint,
      tokenEndpoint,
      registrationEndpoint,
      deviceAuthorizationEndpoint,
      clientId: clientMetadataUrl,
      clientSecret: null,
      tokenEndpointAuthMethod: 'none',
      clientIdMetadataDocumentUrl: clientMetadataUrl,
      redirectUri: input.redirectUri,
      scopes,
      resource: input.resource,
      resourceIndicators,
      audiences,
    };
  }

  if (!registrationEndpoint) {
    throw new ValidationError('Remote MCP authorization server does not support client metadata documents, dynamic client registration, or a manual client');
  }

  const registration = await registerOAuthClient({
    registrationEndpoint,
    authorizationEndpoint,
    scopes,
    platformPublicBaseUrl: input.platformPublicBaseUrl,
    redirectUri: input.redirectUri,
    fetcher: input.fetcher,
  });

  return {
    issuer: input.metadata.issuer,
    authorizationEndpoint,
    tokenEndpoint,
    registrationEndpoint,
    deviceAuthorizationEndpoint,
    clientId: registration.clientId,
    clientSecret: encryptOptionalSecret(registration.clientSecret),
    tokenEndpointAuthMethod: registration.tokenEndpointAuthMethod,
    clientIdMetadataDocumentUrl: null,
    redirectUri: input.redirectUri,
    scopes,
    resource: input.resource,
    resourceIndicators,
    audiences,
  };
}

async function registerOAuthClient(input: {
  registrationEndpoint: string;
  authorizationEndpoint: string | null;
  scopes: string[];
  platformPublicBaseUrl: string;
  redirectUri: string;
  fetcher?: typeof fetch;
}): Promise<{
  clientId: string;
  clientSecret: string | null;
  tokenEndpointAuthMethod: 'none' | 'client_secret_post' | 'client_secret_basic';
}> {
  const fetcher = input.fetcher ?? fetch;
  const grantTypes = input.authorizationEndpoint
    ? ['authorization_code', 'refresh_token']
    : ['client_credentials'];
  const responseTypes = input.authorizationEndpoint ? ['code'] : [];
  const response = await fetcher(input.registrationEndpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      client_name: 'Agirunner MCP',
      client_uri: input.platformPublicBaseUrl,
      redirect_uris: [input.redirectUri],
      grant_types: grantTypes,
      response_types: responseTypes,
      token_endpoint_auth_method: 'none',
      scope: input.scopes.join(' '),
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new ValidationError(`Remote MCP OAuth client registration failed with status ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  const payload = await response.json() as Record<string, unknown>;
  const clientId = readString(payload.client_id);
  if (!clientId) {
    throw new ValidationError('Remote MCP OAuth client registration did not return a client_id');
  }
  const authMethod = readString(payload.token_endpoint_auth_method);
  return {
    clientId,
    clientSecret: readString(payload.client_secret),
    tokenEndpointAuthMethod:
      authMethod === 'client_secret_basic' || authMethod === 'client_secret_post'
        ? authMethod
        : 'none',
  };
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const normalized = readString(entry);
    return normalized ? [normalized] : [];
  });
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function encryptOptionalSecret(value: string | null | undefined): string | null {
  return value && value.trim().length > 0
    ? encryptRemoteMcpSecret(value.trim())
    : null;
}
