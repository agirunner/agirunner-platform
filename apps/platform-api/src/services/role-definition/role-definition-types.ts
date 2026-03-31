import type { ExecutionEnvironmentSummary } from '../execution-environment-contract.js';

export interface RoleDefinitionDbRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  system_prompt: string | null;
  allowed_tools: string[];
  model_preference: string | null;
  verification_strategy: string | null;
  execution_environment_id: string | null;
  escalation_target: string | null;
  max_escalation_depth: number;
  is_active: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export interface ExecutionEnvironmentJoinRow {
  ee_id: string | null;
  ee_name: string | null;
  ee_source_kind: string | null;
  ee_catalog_key: string | null;
  ee_catalog_version: number | null;
  ee_image: string | null;
  ee_cpu: string | null;
  ee_memory: string | null;
  ee_pull_policy: string | null;
  ee_compatibility_status: string | null;
  ee_verification_contract_version: string | null;
  ee_verified_metadata: unknown;
  ee_tool_capabilities: unknown;
  ee_bootstrap_commands: unknown;
  ee_bootstrap_required_domains: unknown;
  ee_catalog_support_status: string | null;
  mcp_server_ids?: unknown;
  skill_ids?: unknown;
  mcp_servers?: unknown;
  skills?: unknown;
}

export type RoleDefinitionQueryRow = RoleDefinitionDbRow & ExecutionEnvironmentJoinRow;

export interface RoleDefinitionRow extends RoleDefinitionDbRow {
  execution_environment: ExecutionEnvironmentSummary | null;
  mcp_server_ids: string[];
  skill_ids: string[];
  mcp_servers: Array<Record<string, unknown>>;
  skills: Array<Record<string, unknown>>;
}
