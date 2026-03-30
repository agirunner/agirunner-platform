import type { ExecutionEnvironmentSummary } from './execution-environment-contract.js';

export interface ExecutionEnvironmentRow {
  id: string;
  tenant_id: string;
  slug: string;
  name: string;
  description: string | null;
  source_kind: string;
  catalog_key: string | null;
  catalog_version: number | null;
  image: string;
  cpu: string;
  memory: string;
  pull_policy: string;
  bootstrap_commands: unknown;
  bootstrap_required_domains: unknown;
  operator_notes: string | null;
  declared_metadata: unknown;
  verified_metadata: unknown;
  tool_capabilities: unknown;
  compatibility_status: string;
  compatibility_errors: unknown;
  verification_contract_version: string | null;
  last_verified_at: Date | null;
  is_default: boolean;
  is_archived: boolean;
  is_claimable: boolean;
  created_at: Date;
  updated_at: Date;
  support_status: string | null;
  usage_count: number;
}

export interface ExecutionEnvironmentRecord extends ExecutionEnvironmentSummary {
  description: string | null;
  operator_notes: string | null;
  declared_metadata: Record<string, unknown>;
  compatibility_errors: string[];
  is_default: boolean;
  is_archived: boolean;
  is_claimable: boolean;
  last_verified_at: Date | null;
  usage_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface CreateExecutionEnvironmentInput {
  name: string;
  description?: string;
  image: string;
  cpu: string;
  memory: string;
  pullPolicy: 'always' | 'if-not-present' | 'never';
  bootstrapCommands?: string[];
  bootstrapRequiredDomains?: string[];
  operatorNotes?: string;
}

export interface CreateExecutionEnvironmentFromCatalogInput {
  catalogKey: string;
  catalogVersion: number;
  name?: string;
  description?: string;
  operatorNotes?: string;
}

export interface UpdateExecutionEnvironmentInput {
  name?: string;
  description?: string | null;
  image?: string;
  cpu?: string;
  memory?: string;
  pullPolicy?: 'always' | 'if-not-present' | 'never';
  bootstrapCommands?: string[];
  bootstrapRequiredDomains?: string[];
  operatorNotes?: string | null;
}

export interface InsertExecutionEnvironmentInput {
  name: string;
  description: string | null;
  source_kind: 'catalog' | 'custom';
  catalog_key: string | null;
  catalog_version: number | null;
  image: string;
  cpu: string;
  memory: string;
  pull_policy: 'always' | 'if-not-present' | 'never';
  bootstrap_commands: string[];
  bootstrap_required_domains: string[];
  operator_notes: string | null;
  declared_metadata: Record<string, unknown>;
  support_status: 'active' | 'deprecated' | 'blocked' | null;
  compatibility_status: 'unknown' | 'compatible' | 'incompatible';
  compatibility_errors: string[];
  verification_contract_version: string | null;
  verified_metadata: Record<string, unknown>;
  tool_capabilities: Record<string, unknown>;
  is_claimable: boolean;
}
