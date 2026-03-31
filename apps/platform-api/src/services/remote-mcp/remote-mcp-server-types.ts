import type {
  RemoteMcpOAuthConfigRecord,
  RemoteMcpOAuthCredentialsRecord,
  RemoteMcpOauthDefinition,
  RemoteMcpParameterInput,
  RemoteMcpTransportPreference,
} from './core/remote-mcp-model.js';

export interface RemoteMcpServerRow {
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
  oauth_client_profile_id: string | null;
  oauth_client_profile_name?: string | null;
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
  oauth_client_profile_id: string | null;
  oauth_client_profile_name: string | null;
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
