import type {
  DashboardRemoteMcpOAuthClientProfileCreateInput,
  DashboardRemoteMcpOAuthClientProfileRecord,
  DashboardRemoteMcpOAuthClientProfileUpdateInput,
  DashboardRemoteMcpOauthCallbackMode,
  DashboardRemoteMcpOauthTokenEndpointAuthMethod,
} from '../../lib/api.js';
import { REMOTE_MCP_STORED_SECRET_VALUE } from './mcp-page.support.js';

export interface RemoteMcpOAuthClientProfileFormState {
  name: string;
  description: string;
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string;
  deviceAuthorizationEndpoint: string;
  callbackMode: DashboardRemoteMcpOauthCallbackMode;
  tokenEndpointAuthMethod: DashboardRemoteMcpOauthTokenEndpointAuthMethod;
  clientId: string;
  clientSecret: string;
  hasStoredClientSecret: boolean;
  defaultScopesText: string;
  defaultResourceIndicatorsText: string;
  defaultAudiencesText: string;
}

export function createRemoteMcpOAuthClientProfileForm(
  profile?: DashboardRemoteMcpOAuthClientProfileRecord | null,
): RemoteMcpOAuthClientProfileFormState {
  return {
    name: profile?.name ?? '',
    description: profile?.description ?? '',
    issuer: profile?.issuer ?? '',
    authorizationEndpoint: profile?.authorization_endpoint ?? '',
    tokenEndpoint: profile?.token_endpoint ?? '',
    registrationEndpoint: profile?.registration_endpoint ?? '',
    deviceAuthorizationEndpoint: profile?.device_authorization_endpoint ?? '',
    callbackMode: profile?.callback_mode ?? 'loopback',
    tokenEndpointAuthMethod: profile?.token_endpoint_auth_method ?? 'none',
    clientId: profile?.client_id ?? '',
    clientSecret: isStoredSecretValue(profile?.client_secret) ? '' : profile?.client_secret ?? '',
    hasStoredClientSecret: Boolean(profile?.has_stored_client_secret),
    defaultScopesText: joinLineValues(profile?.default_scopes),
    defaultResourceIndicatorsText: joinLineValues(profile?.default_resource_indicators),
    defaultAudiencesText: joinLineValues(profile?.default_audiences),
  };
}

export function buildRemoteMcpOAuthClientProfileCreatePayload(
  form: RemoteMcpOAuthClientProfileFormState,
): DashboardRemoteMcpOAuthClientProfileCreateInput {
  return {
    name: form.name.trim(),
    description: form.description.trim(),
    issuer: normalizeOptionalText(form.issuer),
    authorizationEndpoint: normalizeOptionalText(form.authorizationEndpoint),
    tokenEndpoint: form.tokenEndpoint.trim(),
    registrationEndpoint: normalizeOptionalText(form.registrationEndpoint),
    deviceAuthorizationEndpoint: normalizeOptionalText(form.deviceAuthorizationEndpoint),
    callbackMode: form.callbackMode,
    tokenEndpointAuthMethod: form.tokenEndpointAuthMethod,
    clientId: form.clientId.trim(),
    clientSecret: normalizeStoredSecretField(form.clientSecret, form.hasStoredClientSecret),
    defaultScopes: splitLineValues(form.defaultScopesText),
    defaultResourceIndicators: splitLineValues(form.defaultResourceIndicatorsText),
    defaultAudiences: splitLineValues(form.defaultAudiencesText),
  };
}

export function buildRemoteMcpOAuthClientProfileUpdatePayload(
  form: RemoteMcpOAuthClientProfileFormState,
): DashboardRemoteMcpOAuthClientProfileUpdateInput {
  return buildRemoteMcpOAuthClientProfileCreatePayload(form);
}

function isStoredSecretValue(value: string | null | undefined): boolean {
  return value === REMOTE_MCP_STORED_SECRET_VALUE;
}

function joinLineValues(value: string[] | undefined): string {
  return Array.isArray(value) ? value.join('\n') : '';
}

function splitLineValues(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function normalizeOptionalText(value: string): string | null {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeStoredSecretField(
  value: string,
  hasStoredSecret: boolean,
): string | null | undefined {
  const normalized = value.trim();
  if (normalized.length > 0) {
    return normalized;
  }
  return hasStoredSecret ? undefined : null;
}
