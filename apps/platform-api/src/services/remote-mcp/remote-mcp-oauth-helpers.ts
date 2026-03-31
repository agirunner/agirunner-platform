import { ValidationError } from '../../errors/domain-errors.js';
import {
  remoteMcpOauthDefinitionSchema,
  remoteMcpParameterSchema,
  type RemoteMcpOAuthConfigRecord,
  type RemoteMcpOAuthCredentialsRecord,
  type RemoteMcpOauthDefinition,
  type RemoteMcpParameterInput,
} from '../remote-mcp-model.js';
import type { RemoteMcpOAuthClientProfileRecord } from '../remote-mcp-oauth-client-profile-service.js';
import type { TokenResponse } from '../remote-mcp-oauth-types.js';
import {
  encryptRemoteMcpSecret,
  isRemoteMcpSecretEncrypted,
} from '../remote-mcp-secret-crypto.js';

const ACCESS_TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export function requirePlatformPublicBaseUrl(value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    throw new ValidationError('Platform public base URL is required for remote MCP OAuth flows');
  }
  return value.trim();
}

export function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function parseDraftParameters(value: unknown): RemoteMcpParameterInput[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const parsed = remoteMcpParameterSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

export function parseDraftOauthDefinition(value: unknown): RemoteMcpOauthDefinition | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return remoteMcpOauthDefinitionSchema.parse(value);
}

export function persistableOauthDefinition(
  value: RemoteMcpOauthDefinition | null,
): RemoteMcpOauthDefinition | null {
  if (!value) {
    return null;
  }
  return {
    ...value,
    clientSecret: value.clientSecret ? encryptRemoteMcpSecret(value.clientSecret) : null,
    privateKeyPem: value.privateKeyPem ? encryptRemoteMcpSecret(value.privateKeyPem) : null,
  };
}

export function mergeOauthDefinitionWithClientProfile(
  oauthDefinition: RemoteMcpOauthDefinition | null,
  profile: RemoteMcpOAuthClientProfileRecord,
): RemoteMcpOauthDefinition {
  return {
    ...oauthDefinition,
    callbackMode: readEnumOverride(oauthDefinition?.callbackMode, 'loopback') ?? profile.callback_mode,
    clientId: oauthDefinition?.clientId ?? profile.client_id,
    clientSecret: oauthDefinition?.clientSecret ?? profile.client_secret,
    tokenEndpointAuthMethod:
      readEnumOverride(oauthDefinition?.tokenEndpointAuthMethod, 'none')
      ?? profile.token_endpoint_auth_method,
    authorizationEndpointOverride:
      oauthDefinition?.authorizationEndpointOverride ?? profile.authorization_endpoint,
    tokenEndpointOverride:
      oauthDefinition?.tokenEndpointOverride ?? profile.token_endpoint,
    registrationEndpointOverride:
      oauthDefinition?.registrationEndpointOverride ?? profile.registration_endpoint,
    deviceAuthorizationEndpointOverride:
      oauthDefinition?.deviceAuthorizationEndpointOverride ?? profile.device_authorization_endpoint,
    scopes:
      oauthDefinition?.scopes && oauthDefinition.scopes.length > 0
        ? oauthDefinition.scopes
        : profile.default_scopes,
    resourceIndicators:
      oauthDefinition?.resourceIndicators && oauthDefinition.resourceIndicators.length > 0
        ? oauthDefinition.resourceIndicators
        : profile.default_resource_indicators,
    audiences:
      oauthDefinition?.audiences && oauthDefinition.audiences.length > 0
        ? oauthDefinition.audiences
        : profile.default_audiences,
  };
}

export function persistableOauthConfig(
  value: RemoteMcpOAuthConfigRecord,
): RemoteMcpOAuthConfigRecord {
  return {
    ...value,
    clientSecret: value.clientSecret
      ? isRemoteMcpSecretEncrypted(value.clientSecret)
        ? value.clientSecret
        : encryptRemoteMcpSecret(value.clientSecret)
      : null,
  };
}

export function buildStoredOauthCredentials(
  token: TokenResponse,
  userId: string,
): RemoteMcpOAuthCredentialsRecord {
  if (!token.access_token || token.access_token.trim() === '') {
    throw new ValidationError('Remote MCP OAuth token exchange did not return an access token');
  }
  return {
    accessToken: encryptRemoteMcpSecret(token.access_token.trim()),
    refreshToken: token.refresh_token?.trim() ? encryptRemoteMcpSecret(token.refresh_token.trim()) : null,
    expiresAt: typeof token.expires_in === 'number' && Number.isFinite(token.expires_in)
      ? Date.now() + (token.expires_in * 1000)
      : null,
    tokenType: token.token_type?.trim() || 'Bearer',
    scope: token.scope?.trim() || null,
    authorizedAt: new Date().toISOString(),
    authorizedByUserId: userId,
    needsReauth: false,
  };
}

export function isExpired(expiresAt: number | null): boolean {
  return typeof expiresAt === 'number'
    && Number.isFinite(expiresAt)
    && expiresAt <= (Date.now() + ACCESS_TOKEN_EXPIRY_BUFFER_MS);
}

export function selectAuthorizeQueryParameters(
  parameters: RemoteMcpParameterInput[],
): Array<{ key: string; value: string }> {
  return parameters.flatMap((parameter) => {
    if (parameter.placement !== 'authorize_request_query') {
      return [];
    }
    const value = parameter.value.trim();
    return value ? [{ key: parameter.key, value }] : [];
  });
}

export function resolveEffectiveGrantType(
  oauthDefinition: RemoteMcpOauthDefinition | null,
): 'authorization_code' | 'device_authorization' | 'client_credentials' {
  const grantType = oauthDefinition?.grantType ?? 'authorization_code';
  if (grantType === 'client_credentials' || grantType === 'device_authorization') {
    return grantType;
  }
  if (grantType === 'enterprise_managed_authorization') {
    const enterpriseGrantType = readString(oauthDefinition?.enterpriseProfile?.grant_type);
    if (enterpriseGrantType === 'client_credentials' || enterpriseGrantType === 'device_authorization') {
      return enterpriseGrantType;
    }
  }
  return 'authorization_code';
}

function readEnumOverride<T extends string>(value: T | undefined, neutralValue: T): T | undefined {
  return value && value !== neutralValue ? value : undefined;
}
