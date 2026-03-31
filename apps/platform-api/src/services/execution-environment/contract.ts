export const EXECUTION_ENVIRONMENT_CONTRACT_VERSION = 'v1';

export const EXECUTION_ENVIRONMENT_SOURCE_KINDS = ['catalog', 'custom'] as const;
export const EXECUTION_ENVIRONMENT_PULL_POLICIES = ['always', 'if-not-present', 'never'] as const;
export const EXECUTION_ENVIRONMENT_COMPATIBILITY_STATUSES = [
  'unknown',
  'compatible',
  'incompatible',
] as const;
export const EXECUTION_ENVIRONMENT_SUPPORT_STATUSES = [
  'active',
  'deprecated',
  'blocked',
] as const;

export type ExecutionEnvironmentSourceKind =
  typeof EXECUTION_ENVIRONMENT_SOURCE_KINDS[number];
export type ExecutionEnvironmentPullPolicy =
  typeof EXECUTION_ENVIRONMENT_PULL_POLICIES[number];
export type ExecutionEnvironmentCompatibilityStatus =
  typeof EXECUTION_ENVIRONMENT_COMPATIBILITY_STATUSES[number];
export type ExecutionEnvironmentSupportStatus =
  typeof EXECUTION_ENVIRONMENT_SUPPORT_STATUSES[number];

export interface ExecutionContainerContract {
  image: string;
  cpu: string;
  memory: string;
  pull_policy: ExecutionEnvironmentPullPolicy;
}

export interface ExecutionEnvironmentSummary {
  id: string;
  name: string;
  source_kind: ExecutionEnvironmentSourceKind;
  catalog_key: string | null;
  catalog_version: number | null;
  image: string;
  cpu: string;
  memory: string;
  pull_policy: ExecutionEnvironmentPullPolicy;
  compatibility_status: ExecutionEnvironmentCompatibilityStatus;
  support_status: ExecutionEnvironmentSupportStatus | null;
  verification_contract_version: string | null;
  verified_metadata: Record<string, unknown>;
  tool_capabilities: Record<string, unknown>;
  bootstrap_commands: string[];
  bootstrap_required_domains: string[];
  agent_hint: string;
}

export interface ExecutionEnvironmentSnapshot extends ExecutionEnvironmentSummary {}

export interface ExecutionEnvironmentCatalogRecord {
  catalog_key: string;
  catalog_version: number;
  name: string;
  description: string | null;
  image: string;
  cpu: string;
  memory: string;
  pull_policy: ExecutionEnvironmentPullPolicy;
  bootstrap_commands: string[];
  bootstrap_required_domains: string[];
  declared_metadata: Record<string, unknown>;
  support_status: ExecutionEnvironmentSupportStatus;
  replacement_catalog_key: string | null;
  replacement_catalog_version: number | null;
  created_at: Date;
}

export interface ExecutionEnvironmentVerificationResult {
  compatibility_status: Extract<
    ExecutionEnvironmentCompatibilityStatus,
    'compatible' | 'incompatible'
  >;
  compatibility_errors: string[];
  verification_contract_version: string;
  verified_metadata: Record<string, unknown>;
  tool_capabilities: Record<string, unknown>;
  probe_output: Record<string, unknown>;
}

export function buildExecutionEnvironmentAgentHint(input: {
  name: string;
  image: string;
  verifiedMetadata: Record<string, unknown>;
  toolCapabilities: Record<string, unknown>;
}): string {
  const osFamily = readMetadataString(input.verifiedMetadata, 'os_family');
  const distro = readMetadataString(input.verifiedMetadata, 'distro');
  const distroVersion = readMetadataString(input.verifiedMetadata, 'distro_version');
  const packageManager = readMetadataString(input.verifiedMetadata, 'package_manager');
  const shell = readMetadataString(input.verifiedMetadata, 'shell');
  const runtimes = readMetadataStringArray(input.verifiedMetadata, 'detected_runtimes');
  const verifiedCommands = readMetadataStringArray(
    input.toolCapabilities,
    'verified_baseline_commands',
  );

  return [
    `Execution environment: ${input.name}`,
    `Image: ${input.image}`,
    osFamily ? `OS family: ${osFamily}` : null,
    distro ? `Distro: ${distro}${distroVersion ? ` ${distroVersion}` : ''}` : null,
    packageManager ? `Package manager: ${packageManager}` : null,
    shell ? `Shell: ${shell}` : null,
    runtimes.length > 0 ? `Detected runtimes: ${runtimes.join(', ')}` : null,
    verifiedCommands.length > 0
      ? `Verified baseline commands: ${verifiedCommands.join(', ')}`
      : null,
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join('\n');
}

export function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readMetadataString(
  value: Record<string, unknown>,
  key: string,
): string | null {
  const entry = value[key];
  return typeof entry === 'string' && entry.trim().length > 0 ? entry.trim() : null;
}

function readMetadataStringArray(
  value: Record<string, unknown>,
  key: string,
): string[] {
  return normalizeStringArray(value[key]);
}
