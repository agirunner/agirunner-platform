import type {
  DashboardRemoteMcpOauthDefinition,
  DashboardRemoteMcpServerParameterInput,
  DashboardRemoteMcpServerCreateInput,
  DashboardRemoteMcpServerParameterRecord,
  DashboardRemoteMcpServerRecord,
  DashboardRemoteMcpServerUpdateInput,
} from '../../lib/api.js';
import {
  DEFAULT_REMOTE_MCP_CALL_TIMEOUT_SECONDS,
  REMOTE_MCP_STORED_SECRET_VALUE,
  type RemoteMcpOauthFormState,
  type RemoteMcpParameterFormState,
  type RemoteMcpServerFormValidation,
  type RemoteMcpServerFormState,
} from './mcp-page.form.types.js';

export function createRemoteMcpServerForm(
  server?: DashboardRemoteMcpServerRecord | null,
): RemoteMcpServerFormState {
  const parameters = server?.parameters?.map(createParameterFormFromRecord) ?? [];
  return {
    name: server?.name ?? '',
    description: server?.description ?? '',
    endpointUrl: server?.endpoint_url ?? '',
    transportPreference: server?.transport_preference ?? 'auto',
    callTimeoutSeconds: String(server?.call_timeout_seconds ?? DEFAULT_REMOTE_MCP_CALL_TIMEOUT_SECONDS),
    authMode: server?.auth_mode ?? 'none',
    enabledByDefaultForNewSpecialists:
      server?.enabled_by_default_for_new_specialists ?? false,
    grantToAllExistingSpecialists: false,
    oauthClientProfileId: server?.oauth_client_profile_id ?? '',
    oauth: createRemoteMcpOauthForm(server?.oauth_definition ?? null),
    parameters,
  };
}

export function createRemoteMcpParameterForm(): RemoteMcpParameterFormState {
  return {
    id: crypto.randomUUID(),
    placement: 'query',
    key: '',
    valueKind: 'static',
    value: '',
    hasStoredSecret: false,
  };
}

export function validateRemoteMcpServerForm(
  form: RemoteMcpServerFormState,
): RemoteMcpServerFormValidation {
  const fieldErrors: RemoteMcpServerFormValidation['fieldErrors'] = {};

  if (!form.name.trim()) {
    fieldErrors.name = 'Enter a remote MCP server name.';
  }

  const normalizedEndpointUrl = form.endpointUrl.trim();
  if (!normalizedEndpointUrl) {
    fieldErrors.endpointUrl = 'Enter the endpoint URL.';
  } else {
    try {
      const parsed = new URL(normalizedEndpointUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        fieldErrors.endpointUrl = 'Endpoint URL must use http:// or https://.';
      }
    } catch {
      fieldErrors.endpointUrl = 'Enter a valid endpoint URL.';
    }
  }

  const normalizedCallTimeout = form.callTimeoutSeconds.trim();
  const parsedCallTimeout = Number.parseInt(normalizedCallTimeout, 10);
  if (!normalizedCallTimeout) {
    fieldErrors.callTimeoutSeconds = 'Enter a call timeout in seconds.';
  } else if (!Number.isInteger(parsedCallTimeout) || parsedCallTimeout <= 0) {
    fieldErrors.callTimeoutSeconds = 'Call timeout must be a positive whole number of seconds.';
  }

  return {
    fieldErrors,
    isValid: Object.keys(fieldErrors).length === 0,
  };
}

export function buildRemoteMcpCreatePayload(
  form: RemoteMcpServerFormState,
): DashboardRemoteMcpServerCreateInput {
  return {
    name: form.name.trim(),
    description: form.description.trim(),
    endpointUrl: form.endpointUrl.trim(),
    transportPreference: form.transportPreference,
    callTimeoutSeconds: parseCallTimeoutSeconds(form.callTimeoutSeconds),
    authMode: form.authMode,
    enabledByDefaultForNewSpecialists: form.enabledByDefaultForNewSpecialists,
    grantToAllExistingSpecialists: form.grantToAllExistingSpecialists,
    oauthClientProfileId: buildOauthClientProfileId(form),
    oauthDefinition: buildOauthDefinition(form),
    parameters: buildRemoteMcpParameters(form.parameters),
  };
}

export function buildRemoteMcpUpdatePayload(
  form: RemoteMcpServerFormState,
): DashboardRemoteMcpServerUpdateInput {
  return {
    name: form.name.trim(),
    description: form.description.trim(),
    endpointUrl: form.endpointUrl.trim(),
    transportPreference: form.transportPreference,
    callTimeoutSeconds: parseCallTimeoutSeconds(form.callTimeoutSeconds),
    authMode: form.authMode,
    enabledByDefaultForNewSpecialists: form.enabledByDefaultForNewSpecialists,
    oauthClientProfileId: buildOauthClientProfileId(form),
    oauthDefinition: buildOauthDefinition(form),
    parameters: buildRemoteMcpParameters(form.parameters),
  };
}

export function normalizeParametersForAuthMode(
  parameters: RemoteMcpParameterFormState[],
  authMode: RemoteMcpServerFormState['authMode'],
): RemoteMcpParameterFormState[] {
  return parameters.map((parameter) => ({
    ...parameter,
    placement: normalizePlacementForAuthMode(parameter.placement, authMode),
    valueKind: authMode === 'none' ? 'static' : parameter.valueKind,
    value: authMode === 'none' && parameter.valueKind === 'secret' ? '' : parameter.value,
    hasStoredSecret: authMode === 'none' ? false : parameter.hasStoredSecret,
  }));
}

function createParameterFormFromRecord(
  parameter: DashboardRemoteMcpServerParameterRecord,
): RemoteMcpParameterFormState {
  return {
    id: parameter.id,
    placement: parameter.placement,
    key: parameter.key,
    valueKind: parameter.value_kind,
    value:
      parameter.value_kind === 'secret'
      && (parameter.has_stored_secret || parameter.value === REMOTE_MCP_STORED_SECRET_VALUE)
        ? ''
        : parameter.value,
    hasStoredSecret:
      parameter.value_kind === 'secret'
      && (parameter.has_stored_secret || parameter.value === REMOTE_MCP_STORED_SECRET_VALUE),
  };
}

function createRemoteMcpOauthForm(
  oauthDefinition: DashboardRemoteMcpOauthDefinition | null,
): RemoteMcpOauthFormState {
  return {
    grantType: oauthDefinition?.grantType ?? 'authorization_code',
    clientStrategy: oauthDefinition?.clientStrategy ?? 'auto',
    callbackMode: oauthDefinition?.callbackMode ?? 'loopback',
    clientId: oauthDefinition?.clientId ?? '',
    clientSecret: isStoredSecretValue(oauthDefinition?.clientSecret) ? '' : oauthDefinition?.clientSecret ?? '',
    hasStoredClientSecret: isStoredSecretValue(oauthDefinition?.clientSecret),
    tokenEndpointAuthMethod: oauthDefinition?.tokenEndpointAuthMethod ?? 'none',
    authorizationEndpointOverride: oauthDefinition?.authorizationEndpointOverride ?? '',
    tokenEndpointOverride: oauthDefinition?.tokenEndpointOverride ?? '',
    registrationEndpointOverride: oauthDefinition?.registrationEndpointOverride ?? '',
    deviceAuthorizationEndpointOverride: oauthDefinition?.deviceAuthorizationEndpointOverride ?? '',
    protectedResourceMetadataUrlOverride: oauthDefinition?.protectedResourceMetadataUrlOverride ?? '',
    authorizationServerMetadataUrlOverride: oauthDefinition?.authorizationServerMetadataUrlOverride ?? '',
    scopesText: joinLineValues(oauthDefinition?.scopes),
    resourceIndicatorsText: joinLineValues(oauthDefinition?.resourceIndicators),
    audiencesText: joinLineValues(oauthDefinition?.audiences),
    enterpriseProfileText: oauthDefinition?.enterpriseProfile ? JSON.stringify(oauthDefinition.enterpriseProfile, null, 2) : '',
    parMode: oauthDefinition?.parMode ?? 'disabled',
    jarMode: oauthDefinition?.jarMode ?? 'disabled',
    privateKeyPem: isStoredSecretValue(oauthDefinition?.privateKeyPem) ? '' : oauthDefinition?.privateKeyPem ?? '',
    hasStoredPrivateKeyPem: isStoredSecretValue(oauthDefinition?.privateKeyPem),
  };
}

function buildOauthDefinition(
  form: RemoteMcpServerFormState,
): DashboardRemoteMcpOauthDefinition | null {
  if (form.authMode !== 'oauth') {
    return null;
  }

  return compactRecord<DashboardRemoteMcpOauthDefinition>({
    grantType: form.oauth.grantType,
    clientStrategy: form.oauth.clientStrategy,
    callbackMode: form.oauth.callbackMode,
    clientId: normalizeOptionalText(form.oauth.clientId),
    clientSecret: normalizeStoredSecretField(form.oauth.clientSecret, form.oauth.hasStoredClientSecret),
    tokenEndpointAuthMethod: form.oauth.tokenEndpointAuthMethod,
    authorizationEndpointOverride: normalizeOptionalText(form.oauth.authorizationEndpointOverride),
    tokenEndpointOverride: normalizeOptionalText(form.oauth.tokenEndpointOverride),
    registrationEndpointOverride: normalizeOptionalText(form.oauth.registrationEndpointOverride),
    deviceAuthorizationEndpointOverride: normalizeOptionalText(form.oauth.deviceAuthorizationEndpointOverride),
    protectedResourceMetadataUrlOverride: normalizeOptionalText(form.oauth.protectedResourceMetadataUrlOverride),
    authorizationServerMetadataUrlOverride: normalizeOptionalText(form.oauth.authorizationServerMetadataUrlOverride),
    scopes: splitLineValues(form.oauth.scopesText),
    resourceIndicators: splitLineValues(form.oauth.resourceIndicatorsText),
    audiences: splitLineValues(form.oauth.audiencesText),
    enterpriseProfile: parseEnterpriseProfile(form.oauth.enterpriseProfileText),
    parMode: form.oauth.parMode,
    jarMode: form.oauth.jarMode,
    privateKeyPem: normalizeStoredSecretField(form.oauth.privateKeyPem, form.oauth.hasStoredPrivateKeyPem),
  });
}

function buildOauthClientProfileId(
  form: RemoteMcpServerFormState,
): string | null | undefined {
  if (form.authMode !== 'oauth') {
    return null;
  }
  const normalized = form.oauthClientProfileId.trim();
  return normalized.length > 0 ? normalized : null;
}

function buildRemoteMcpParameters(
  parameters: RemoteMcpParameterFormState[],
): DashboardRemoteMcpServerParameterInput[] {
  return parameters.flatMap((parameter) => {
    const key = parameter.key.trim();
    if (!key) {
      return [];
    }
    const normalizedValue = normalizeParameterValue(parameter);
    if (!normalizedValue) {
      return [];
    }
    return [{
      id: parameter.id,
      placement: parameter.placement,
      key,
      valueKind: parameter.valueKind,
      value: normalizedValue,
    }];
  });
}

function normalizeParameterValue(parameter: RemoteMcpParameterFormState): string | null {
  const value = parameter.value.trim();
  if (parameter.valueKind === 'secret') {
    if (value.length > 0) {
      return value;
    }
    return parameter.hasStoredSecret ? REMOTE_MCP_STORED_SECRET_VALUE : null;
  }
  return value.length > 0 ? value : null;
}

function normalizePlacementForAuthMode(
  placement: RemoteMcpParameterFormState['placement'],
  authMode: RemoteMcpServerFormState['authMode'],
): RemoteMcpParameterFormState['placement'] {
  if (authMode === 'oauth') {
    return placement;
  }
  return placement === 'authorize_request_query'
    || placement === 'device_request_query'
    || placement === 'device_request_header'
    || placement === 'device_request_body_form'
    || placement === 'device_request_body_json'
    || placement === 'token_request_query'
    || placement === 'token_request_header'
    || placement === 'token_request_body_form'
    || placement === 'token_request_body_json'
    ? 'query'
    : placement;
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

function parseEnterpriseProfile(value: string): Record<string, unknown> | null {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  try {
    const parsed = JSON.parse(normalized) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Enterprise profile must be a JSON object.');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      error instanceof Error && error.message
        ? error.message
        : 'Enterprise profile must be a valid JSON object.',
    );
  }
}

function isStoredSecretValue(value: string | null | undefined): boolean {
  return value === REMOTE_MCP_STORED_SECRET_VALUE;
}

function compactRecord<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

function parseCallTimeoutSeconds(value: string): number {
  const normalized = value.trim();
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('Call timeout must be a positive whole number of seconds.');
  }
  return parsed;
}
