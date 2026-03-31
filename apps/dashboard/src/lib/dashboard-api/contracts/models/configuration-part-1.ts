export interface DashboardAgenticSettingsRecord {
  live_visibility_mode_default: 'standard' | 'enhanced';
  prompt_warning_threshold_chars: number;
  scope: 'tenant';
  revision: number;
  updated_by_operator_id: string | null;
  updated_at: string | null;
}

export interface DashboardAgenticSettingsPatchInput {
  live_visibility_mode_default: 'standard' | 'enhanced';
  prompt_warning_threshold_chars: number;
  settings_revision: number;
}

export interface DashboardLlmProviderRecord {
  id: string;
  name: string;
  auth_mode?: string | null;
  credentials_configured?: boolean;
}

export interface DashboardLlmModelRecord {
  id: string;
  model_id: string;
  provider_id?: string | null;
  provider_name?: string | null;
  native_search?: {
    mode: 'openai_web_search' | 'anthropic_web_search_20250305' | 'google_search';
    defaultEnabled: boolean;
  } | null;
  is_enabled?: boolean;
}

export interface DashboardToolTagRecord {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  owner?: 'runtime' | 'task';
  access_scope?: 'specialist_and_orchestrator' | 'orchestrator_only';
  usage_surface?: 'runtime' | 'task_sandbox' | 'provider_capability';
  is_callable?: boolean;
  created_at?: string;
  is_built_in?: boolean;
}

export interface DashboardToolTagCreateInput {
  id: string;
  name: string;
  description?: string;
  category: string;
}

export interface DashboardToolTagUpdateInput {
  name: string;
  description?: string;
  category: string;
}

export interface DashboardRuntimeDefaultRecord {
  id: string;
  config_key: string;
  config_value: string;
  config_type: string;
  description: string | null;
}

export interface DashboardRuntimeDefaultUpsertInput {
  configKey: string;
  configValue: string;
  configType: 'string' | 'number' | 'boolean';
  description: string;
}

export type DashboardExecutionEnvironmentPullPolicy = 'always' | 'if-not-present' | 'never';

export type DashboardExecutionEnvironmentCompatibilityStatus =
  | 'unknown'
  | 'compatible'
  | 'incompatible';

export type DashboardExecutionEnvironmentSupportStatus = 'active' | 'deprecated' | 'blocked';

export interface DashboardExecutionEnvironmentCatalogRecord {
  catalog_key: string;
  catalog_version: number;
  name: string;
  description?: string | null;
  image: string;
  cpu: string;
  memory: string;
  pull_policy: DashboardExecutionEnvironmentPullPolicy;
  bootstrap_commands: string[];
  bootstrap_required_domains: string[];
  declared_metadata: Record<string, unknown>;
  support_status: DashboardExecutionEnvironmentSupportStatus;
  replacement_catalog_key?: string | null;
  replacement_catalog_version?: number | null;
  created_at?: string;
}

export interface DashboardExecutionEnvironmentRecord {
  id: string;
  name: string;
  description?: string | null;
  source_kind: 'catalog' | 'custom';
  catalog_key?: string | null;
  catalog_version?: number | null;
  image: string;
  cpu: string;
  memory: string;
  pull_policy: DashboardExecutionEnvironmentPullPolicy;
  bootstrap_commands: string[];
  bootstrap_required_domains: string[];
  operator_notes?: string | null;
  declared_metadata: Record<string, unknown>;
  verified_metadata: Record<string, unknown>;
  tool_capabilities: Record<string, unknown>;
  compatibility_status: DashboardExecutionEnvironmentCompatibilityStatus;
  compatibility_errors: string[];
  verification_contract_version?: string | null;
  last_verified_at?: string | null;
  is_default: boolean;
  is_archived: boolean;
  is_claimable: boolean;
  support_status?: DashboardExecutionEnvironmentSupportStatus | null;
  usage_count: number;
  agent_hint: string;
  created_at?: string;
  updated_at?: string;
}

export interface DashboardExecutionEnvironmentCreateInput {
  name: string;
  description?: string;
  image: string;
  cpu: string;
  memory: string;
  pullPolicy: DashboardExecutionEnvironmentPullPolicy;
  operatorNotes?: string;
}

export interface DashboardExecutionEnvironmentCreateFromCatalogInput {
  catalogKey: string;
  catalogVersion: number;
  name?: string;
  description?: string;
  operatorNotes?: string;
}

export interface DashboardExecutionEnvironmentUpdateInput {
  name?: string;
  description?: string | null;
  image?: string;
  cpu?: string;
  memory?: string;
  pullPolicy?: DashboardExecutionEnvironmentPullPolicy;
  operatorNotes?: string | null;
}

export type DashboardRemoteMcpAuthMode = 'none' | 'parameterized' | 'oauth';

export type DashboardRemoteMcpTransportPreference = 'auto' | 'streamable_http' | 'http_sse_compat';

export type DashboardRemoteMcpTransport = 'streamable_http' | 'http_sse_compat';

export type DashboardRemoteMcpParameterPlacement =
  | 'path'
  | 'query'
  | 'header'
  | 'cookie'
  | 'initialize_param'
  | 'authorize_request_query'
  | 'device_request_query'
  | 'device_request_header'
  | 'device_request_body_form'
  | 'device_request_body_json'
  | 'token_request_query'
  | 'token_request_header'
  | 'token_request_body_form'
  | 'token_request_body_json';

export type DashboardRemoteMcpOauthGrantType =
  | 'authorization_code'
  | 'device_authorization'
  | 'client_credentials'
  | 'enterprise_managed_authorization';

export type DashboardRemoteMcpOauthClientStrategy =
  | 'auto'
  | 'dynamic_registration'
  | 'client_metadata_document'
  | 'manual_client';

export type DashboardRemoteMcpOauthCallbackMode = 'loopback' | 'hosted_https';

export type DashboardRemoteMcpOauthTokenEndpointAuthMethod =
  | 'none'
  | 'client_secret_post'
  | 'client_secret_basic'
  | 'private_key_jwt';

export type DashboardRemoteMcpOauthParMode = 'disabled' | 'enabled' | 'required';

export type DashboardRemoteMcpOauthJarMode = 'disabled' | 'request_parameter' | 'request_uri';

export interface DashboardRemoteMcpOAuthClientProfileRecord {
  id: string;
  tenant_id?: string;
  name: string;
  slug: string;
  description: string;
  issuer: string | null;
  authorization_endpoint: string | null;
  token_endpoint: string;
  registration_endpoint: string | null;
  device_authorization_endpoint: string | null;
  callback_mode: DashboardRemoteMcpOauthCallbackMode;
  token_endpoint_auth_method: DashboardRemoteMcpOauthTokenEndpointAuthMethod;
  client_id: string;
  client_secret: string | null;
  has_stored_client_secret: boolean;
  default_scopes: string[];
  default_resource_indicators: string[];
  default_audiences: string[];
  linked_server_count: number;
  created_at: string;
  updated_at: string;
}

export interface DashboardRemoteMcpOAuthClientProfileCreateInput {
  name: string;
  description?: string;
  issuer?: string | null;
  authorizationEndpoint?: string | null;
  tokenEndpoint: string;
  registrationEndpoint?: string | null;
  deviceAuthorizationEndpoint?: string | null;
  callbackMode?: DashboardRemoteMcpOauthCallbackMode;
  tokenEndpointAuthMethod?: DashboardRemoteMcpOauthTokenEndpointAuthMethod;
  clientId: string;
  clientSecret?: string | null;
  defaultScopes?: string[];
  defaultResourceIndicators?: string[];
  defaultAudiences?: string[];
}

export interface DashboardRemoteMcpOAuthClientProfileUpdateInput {
  name?: string;
  description?: string;
  issuer?: string | null;
  authorizationEndpoint?: string | null;
  tokenEndpoint?: string;
  registrationEndpoint?: string | null;
  deviceAuthorizationEndpoint?: string | null;
  callbackMode?: DashboardRemoteMcpOauthCallbackMode;
  tokenEndpointAuthMethod?: DashboardRemoteMcpOauthTokenEndpointAuthMethod;
  clientId?: string;
  clientSecret?: string | null;
  defaultScopes?: string[];
  defaultResourceIndicators?: string[];
  defaultAudiences?: string[];
}

export interface DashboardRemoteMcpOauthDefinition {
  grantType?: DashboardRemoteMcpOauthGrantType;
  clientStrategy?: DashboardRemoteMcpOauthClientStrategy;
  callbackMode?: DashboardRemoteMcpOauthCallbackMode;
  clientId?: string | null;
  clientSecret?: string | null;
  tokenEndpointAuthMethod?: DashboardRemoteMcpOauthTokenEndpointAuthMethod;
  authorizationEndpointOverride?: string | null;
  tokenEndpointOverride?: string | null;
  registrationEndpointOverride?: string | null;
  deviceAuthorizationEndpointOverride?: string | null;
  protectedResourceMetadataUrlOverride?: string | null;
  authorizationServerMetadataUrlOverride?: string | null;
  scopes?: string[];
  resourceIndicators?: string[];
  audiences?: string[];
  enterpriseProfile?: Record<string, unknown> | null;
  parMode?: DashboardRemoteMcpOauthParMode;
  jarMode?: DashboardRemoteMcpOauthJarMode;
  privateKeyPem?: string | null;
}

export interface DashboardRemoteMcpServerParameterRecord {
  id: string;
  placement: DashboardRemoteMcpParameterPlacement;
  key: string;
  value_kind: 'static' | 'secret';
  value: string;
  has_stored_secret: boolean;
}

export interface DashboardRemoteMcpServerRecord {
  id: string;
  tenant_id?: string;
  name: string;
  slug: string;
  description: string;
  endpoint_url: string;
  transport_preference?: DashboardRemoteMcpTransportPreference;
  call_timeout_seconds: number;
  auth_mode: DashboardRemoteMcpAuthMode;
  enabled_by_default_for_new_specialists: boolean;
  is_archived: boolean;
  verification_status: 'unknown' | 'verified' | 'failed';
  verification_error: string | null;
  verified_transport: DashboardRemoteMcpTransport | null;
  verified_discovery_strategy?: string | null;
  verified_oauth_strategy?: string | null;
  verified_at: string | null;
  verification_contract_version: string;
  verified_capability_summary?: Record<string, unknown>;
  discovered_tools_snapshot: Record<string, unknown>[];
  discovered_resources_snapshot?: Record<string, unknown>[];
  discovered_prompts_snapshot?: Record<string, unknown>[];
  discovered_tool_count: number;
  discovered_resource_count?: number;
  discovered_prompt_count?: number;
  assigned_specialist_count: number;
  parameters: DashboardRemoteMcpServerParameterRecord[];
  oauth_definition?: DashboardRemoteMcpOauthDefinition | null;
  oauth_client_profile_id?: string | null;
  oauth_client_profile_name?: string | null;
  oauth_connected: boolean;
  oauth_authorized_at: string | null;
  oauth_needs_reauth: boolean;
  created_at: string;
  updated_at: string;
}

export interface DashboardRemoteMcpServerParameterInput {
  id?: string;
  placement: DashboardRemoteMcpParameterPlacement;
  key: string;
  valueKind: 'static' | 'secret';
  value: string;
}

export interface DashboardRemoteMcpServerCreateInput {
  name: string;
  description?: string;
  endpointUrl: string;
  transportPreference?: DashboardRemoteMcpTransportPreference;
  callTimeoutSeconds: number;
  authMode: DashboardRemoteMcpAuthMode;
  enabledByDefaultForNewSpecialists: boolean;
  grantToAllExistingSpecialists: boolean;
  oauthClientProfileId?: string | null;
  oauthDefinition?: DashboardRemoteMcpOauthDefinition | null;
  parameters: DashboardRemoteMcpServerParameterInput[];
}

export interface DashboardRemoteMcpServerUpdateInput {
  name?: string;
  description?: string;
  endpointUrl?: string;
  transportPreference?: DashboardRemoteMcpTransportPreference;
  callTimeoutSeconds?: number;
  authMode?: DashboardRemoteMcpAuthMode;
  enabledByDefaultForNewSpecialists?: boolean;
  oauthClientProfileId?: string | null;
  oauthDefinition?: DashboardRemoteMcpOauthDefinition | null;
  parameters?: DashboardRemoteMcpServerParameterInput[];
}

export type DashboardRemoteMcpAuthorizeResult =
  | {
      kind: 'browser';
      draftId: string;
      authorizeUrl: string;
    }
  | {
      kind: 'device';
      draftId: string;
      deviceFlowId: string;
      userCode: string;
      verificationUri: string;
      verificationUriComplete: string | null;
      expiresInSeconds: number;
      intervalSeconds: number;
    }
  | {
      kind: 'completed';
      serverId: string;
      serverName: string;
    };

export interface DashboardSpecialistSkillRecord {
  id: string;
  name: string;
  slug: string;
  summary: string | null;
  content: string;
  is_archived: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface DashboardSpecialistSkillCreateInput {
  name: string;
  summary?: string;
  content: string;
}

export interface DashboardSpecialistSkillUpdateInput {
  name?: string;
  summary?: string | null;
  content?: string;
}
