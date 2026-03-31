import { ConflictError, ValidationError } from '../../errors/domain-errors.js';
import type { DatabaseQueryable } from '../../db/database.js';
import {
  assertValidContainerCpu,
  assertValidContainerImage,
  assertValidContainerMemory,
} from '../container-resource-validation.js';
import {
  buildExecutionEnvironmentAgentHint,
  EXECUTION_ENVIRONMENT_CONTRACT_VERSION,
  type ExecutionEnvironmentSummary,
  isRecord,
  normalizeStringArray,
} from './contract.js';
import type {
  CreateExecutionEnvironmentInput,
  ExecutionEnvironmentRecord,
  ExecutionEnvironmentRow,
  UpdateExecutionEnvironmentInput,
} from './types.js';

export function listEnvironmentsSql(): string {
  return `SELECT
    ee.*,
    c.support_status,
    (
      SELECT COUNT(*)::int
        FROM role_definitions rd
       WHERE rd.tenant_id = ee.tenant_id
         AND rd.execution_environment_id = ee.id
    ) + (
      SELECT COUNT(*)::int
        FROM tasks t
       WHERE t.tenant_id = ee.tenant_id
         AND t.execution_environment_id = ee.id
    ) AS usage_count
  FROM execution_environments ee
  LEFT JOIN execution_environment_catalog c
    ON c.catalog_key = ee.catalog_key
   AND c.catalog_version = ee.catalog_version
  WHERE ee.tenant_id = $1`;
}

export function toExecutionEnvironmentRecord(
  row: ExecutionEnvironmentRow,
): ExecutionEnvironmentRecord {
  const verifiedMetadata = isRecord(row.verified_metadata) ? row.verified_metadata : {};
  const toolCapabilities = isRecord(row.tool_capabilities) ? row.tool_capabilities : {};
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    source_kind: row.source_kind === 'catalog' ? 'catalog' : 'custom',
    catalog_key: row.catalog_key,
    catalog_version: row.catalog_version,
    image: row.image,
    cpu: row.cpu,
    memory: row.memory,
    pull_policy:
      row.pull_policy === 'always' || row.pull_policy === 'never'
        ? row.pull_policy
        : 'if-not-present',
    bootstrap_commands: normalizeStringArray(row.bootstrap_commands),
    bootstrap_required_domains: normalizeStringArray(row.bootstrap_required_domains),
    compatibility_status:
      row.compatibility_status === 'compatible' || row.compatibility_status === 'incompatible'
        ? row.compatibility_status
        : 'unknown',
    support_status:
      row.support_status === 'deprecated' || row.support_status === 'blocked'
        ? row.support_status
        : row.source_kind === 'catalog'
          ? 'active'
          : null,
    verification_contract_version: row.verification_contract_version,
    verified_metadata: verifiedMetadata,
    tool_capabilities: toolCapabilities,
    agent_hint: buildExecutionEnvironmentAgentHint({
      name: row.name,
      image: row.image,
      verifiedMetadata,
      toolCapabilities,
    }),
    operator_notes: row.operator_notes,
    declared_metadata: isRecord(row.declared_metadata) ? row.declared_metadata : {},
    compatibility_errors: normalizeStringArray(row.compatibility_errors),
    is_default: row.is_default,
    is_archived: row.is_archived,
    is_claimable: row.is_claimable,
    last_verified_at: row.last_verified_at,
    usage_count: row.usage_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function toExecutionEnvironmentSummary(
  record: ExecutionEnvironmentRecord,
): ExecutionEnvironmentSummary {
  return {
    id: record.id,
    name: record.name,
    source_kind: record.source_kind,
    catalog_key: record.catalog_key,
    catalog_version: record.catalog_version,
    image: record.image,
    cpu: record.cpu,
    memory: record.memory,
    pull_policy: record.pull_policy,
    compatibility_status: record.compatibility_status,
    support_status: record.support_status,
    verification_contract_version:
      record.verification_contract_version ?? EXECUTION_ENVIRONMENT_CONTRACT_VERSION,
    verified_metadata: record.verified_metadata,
    tool_capabilities: record.tool_capabilities,
    bootstrap_commands: record.bootstrap_commands,
    bootstrap_required_domains: record.bootstrap_required_domains,
    agent_hint: record.agent_hint,
  };
}

export function mergeEnvironmentUpdate(
  current: ExecutionEnvironmentRecord,
  input: UpdateExecutionEnvironmentInput,
): CreateExecutionEnvironmentInput {
  return {
    name: input.name ?? current.name,
    description: input.description ?? current.description ?? undefined,
    image: input.image ?? current.image,
    cpu: input.cpu ?? current.cpu,
    memory: input.memory ?? current.memory,
    pullPolicy: input.pullPolicy ?? current.pull_policy,
    bootstrapCommands: input.bootstrapCommands ?? current.bootstrap_commands,
    bootstrapRequiredDomains: input.bootstrapRequiredDomains ?? current.bootstrap_required_domains,
    operatorNotes: input.operatorNotes ?? current.operator_notes ?? undefined,
  };
}

export async function readRoleScopedEnvironmentId(
  db: DatabaseQueryable,
  tenantId: string,
  roleName: string,
): Promise<string | null> {
  const result = await db.query<{ execution_environment_id: string | null }>(
    `SELECT execution_environment_id
       FROM role_definitions
      WHERE tenant_id = $1
        AND name = $2
        AND is_active = true
      LIMIT 1`,
    [tenantId, roleName.trim()],
  );
  return result.rows[0]?.execution_environment_id ?? null;
}

export async function readClaimableEnvironmentRow(
  db: DatabaseQueryable,
  tenantId: string,
  requestedId: string | null,
): Promise<ExecutionEnvironmentRow | null> {
  const result = await db.query<ExecutionEnvironmentRow>(
    `${listEnvironmentsSql()}
       AND ee.is_archived = false
       AND ee.is_claimable = true
       AND COALESCE(c.support_status, 'active') <> 'blocked'
       AND (
         ($2::uuid IS NOT NULL AND ee.id = $2::uuid)
         OR ($2::uuid IS NULL AND ee.is_default = true)
       )
     LIMIT 1`,
    [tenantId, requestedId],
  );
  return result.rows[0] ?? null;
}

export function validateEnvironmentInput(input: CreateExecutionEnvironmentInput): void {
  if (!normalizeOptionalString(input.name)) {
    throw new ValidationError('Execution environment name is required');
  }
  assertValidContainerImage(input.image, 'Execution environment image');
  assertValidContainerCpu(input.cpu, 'Execution environment CPU');
  assertValidContainerMemory(input.memory, 'Execution environment memory');
}

export function normalizeOptionalString(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function normalizeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function handleEnvironmentWriteError(error: unknown): never {
  if (isUniqueViolation(error, 'uq_execution_environments_tenant_slug')) {
    throw new ConflictError('Execution environment name already exists');
  }
  throw error;
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const pgError = error as { code?: string; constraint?: string };
  return pgError.code === '23505' && pgError.constraint === constraint;
}
