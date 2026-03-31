export interface OAuthConfig {
  profile_id: string;
  client_id: string | null;
  authorize_url: string;
  token_url: string | null;
  scopes: string[];
  base_url: string;
  endpoint_type: string;
  token_lifetime: string;
  cost_model: string;
  extra_authorize_params: Record<string, string>;
}

export interface OAuthCredentials {
  access_token: string;
  refresh_token: string | null;
  expires_at: number | null;
  account_id: string | null;
  email: string | null;
  authorized_at: string;
  authorized_by_user_id: string;
  needs_reauth: boolean;
}

export interface OAuthSessionCredentialsInput {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: number | string | null;
  accountId?: string | null;
  email?: string | null;
  authorizedAt?: string;
  authorizedByUserId?: string;
  needsReauth?: boolean;
}

export interface ResolvedOAuthToken {
  accessTokenSecret: string;
  baseUrl: string;
  endpointType: string;
  extraHeadersSecret: string | null;
}

export interface OAuthStatus {
  connected: boolean;
  email: string | null;
  authorizedAt: string | null;
  expiresAt: string | null;
  authorizedBy: string | null;
  needsReauth: boolean;
}

export interface ProviderRow {
  [key: string]: unknown;
  id: string;
  tenant_id: string;
  auth_mode: string;
  oauth_config: OAuthConfig | null;
  oauth_credentials: unknown;
}

export interface StateRow {
  [key: string]: unknown;
  id: string;
  tenant_id: string;
  user_id: string;
  profile_id: string;
  state: string;
  code_verifier: string;
  flow_kind?: string;
}
