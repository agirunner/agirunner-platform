import { ConflictError } from '../../errors/domain-errors.js';
import { sanitizeSecretLikeValue } from '../secret-redaction.js';
import {
  buildExecutionEnvironmentAgentHint,
  isRecord,
  normalizeStringArray,
  type ExecutionEnvironmentSummary,
} from '../execution-environment/contract.js';
import type {
  ExecutionEnvironmentJoinRow,
  RoleDefinitionQueryRow,
  RoleDefinitionRow,
} from './role-definition-types.js';

const ROLE_DEFINITION_SECRET_REDACTION = 'redacted://role-definition-secret';

const REDACTION_OPTIONS = {
  redactionValue: ROLE_DEFINITION_SECRET_REDACTION,
  allowSecretReferences: false,
};

export function roleDefinitionSelectSql(): string {
  return `SELECT
    rd.id,
    rd.tenant_id,
    rd.name,
    rd.description,
    rd.system_prompt,
    rd.allowed_tools,
    rd.model_preference,
    rd.verification_strategy,
    rd.execution_environment_id,
    rd.escalation_target,
    rd.max_escalation_depth,
    rd.is_active,
    rd.version,
    rd.created_at,
    rd.updated_at,
    ee.id AS ee_id,
    ee.name AS ee_name,
    ee.source_kind AS ee_source_kind,
    ee.catalog_key AS ee_catalog_key,
    ee.catalog_version AS ee_catalog_version,
    ee.image AS ee_image,
    ee.cpu AS ee_cpu,
    ee.memory AS ee_memory,
    ee.pull_policy AS ee_pull_policy,
    ee.compatibility_status AS ee_compatibility_status,
    ee.verification_contract_version AS ee_verification_contract_version,
    ee.verified_metadata AS ee_verified_metadata,
    ee.tool_capabilities AS ee_tool_capabilities,
    ee.bootstrap_commands AS ee_bootstrap_commands,
    ee.bootstrap_required_domains AS ee_bootstrap_required_domains,
    c.support_status AS ee_catalog_support_status,
    COALESCE((
      SELECT array_agg(g.remote_mcp_server_id ORDER BY g.remote_mcp_server_id)
        FROM specialist_mcp_server_grants g
       WHERE g.specialist_id = rd.id
    ), ARRAY[]::uuid[]) AS mcp_server_ids,
    COALESCE((
      SELECT array_agg(a.skill_id ORDER BY a.sort_order)
        FROM specialist_skill_assignments a
       WHERE a.specialist_id = rd.id
    ), ARRAY[]::uuid[]) AS skill_ids,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'slug', s.slug,
        'verification_status', s.verification_status,
        'is_archived', s.is_archived
      ) ORDER BY s.name ASC)
        FROM specialist_mcp_server_grants g
        JOIN remote_mcp_servers s
          ON s.id = g.remote_mcp_server_id
       WHERE g.specialist_id = rd.id
    ), '[]'::jsonb) AS mcp_servers,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'slug', s.slug,
        'summary', s.summary,
        'is_archived', s.is_archived
      ) ORDER BY a.sort_order ASC)
        FROM specialist_skill_assignments a
        JOIN specialist_skills s
          ON s.id = a.skill_id
       WHERE a.specialist_id = rd.id
    ), '[]'::jsonb) AS skills
  FROM role_definitions rd
  LEFT JOIN execution_environments ee
    ON ee.tenant_id = rd.tenant_id
   AND ee.id = rd.execution_environment_id
  LEFT JOIN execution_environment_catalog c
    ON c.catalog_key = ee.catalog_key
   AND c.catalog_version = ee.catalog_version`;
}

export function sanitizeRoleDefinitionRow(row: RoleDefinitionQueryRow): RoleDefinitionRow {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    name: row.name,
    description: sanitizeSecretLikeValue(row.description, REDACTION_OPTIONS) as string | null,
    system_prompt: sanitizeSecretLikeValue(row.system_prompt, REDACTION_OPTIONS) as string | null,
    allowed_tools: Array.isArray(row.allowed_tools) ? row.allowed_tools : [],
    model_preference: sanitizeSecretLikeValue(row.model_preference, REDACTION_OPTIONS) as string | null,
    verification_strategy: sanitizeSecretLikeValue(
      row.verification_strategy,
      REDACTION_OPTIONS,
    ) as string | null,
    execution_environment_id: row.execution_environment_id,
    execution_environment: buildExecutionEnvironmentSummary(row),
    escalation_target: sanitizeSecretLikeValue(
      row.escalation_target,
      REDACTION_OPTIONS,
    ) as string | null,
    max_escalation_depth: row.max_escalation_depth,
    is_active: row.is_active,
    mcp_server_ids: normalizeUuidArray(row.mcp_server_ids),
    skill_ids: normalizeUuidArray(row.skill_ids),
    mcp_servers: normalizeObjectArray(row.mcp_servers),
    skills: normalizeObjectArray(row.skills),
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function normalizeOptionalString(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function handleRoleWriteError(error: unknown): void {
  if (!error || typeof error !== 'object') {
    return;
  }
  const pgError = error as { code?: string };
  if (pgError.code === '23505') {
    throw new ConflictError('Role definition already exists');
  }
}

function normalizeUuidArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => (typeof entry === 'string' ? [entry] : []))
    : [];
}

function normalizeObjectArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.flatMap((entry) => (isRecord(entry) ? [entry] : []))
    : [];
}

function buildExecutionEnvironmentSummary(
  row: ExecutionEnvironmentJoinRow,
): ExecutionEnvironmentSummary | null {
  if (!row.ee_id || !row.ee_name || !row.ee_source_kind || !row.ee_image || !row.ee_cpu || !row.ee_memory || !row.ee_pull_policy) {
    return null;
  }

  const verifiedMetadata = isRecord(row.ee_verified_metadata) ? row.ee_verified_metadata : {};
  const toolCapabilities = isRecord(row.ee_tool_capabilities) ? row.ee_tool_capabilities : {};
  return {
    id: row.ee_id,
    name: row.ee_name,
    source_kind: row.ee_source_kind === 'catalog' ? 'catalog' : 'custom',
    catalog_key: row.ee_catalog_key,
    catalog_version: row.ee_catalog_version,
    image: row.ee_image,
    cpu: row.ee_cpu,
    memory: row.ee_memory,
    pull_policy:
      row.ee_pull_policy === 'always' || row.ee_pull_policy === 'never'
        ? row.ee_pull_policy
        : 'if-not-present',
    compatibility_status:
      row.ee_compatibility_status === 'compatible' || row.ee_compatibility_status === 'incompatible'
        ? row.ee_compatibility_status
        : 'unknown',
    support_status:
      row.ee_catalog_support_status === 'deprecated' || row.ee_catalog_support_status === 'blocked'
        ? row.ee_catalog_support_status
        : row.ee_source_kind === 'catalog'
          ? 'active'
          : null,
    verification_contract_version: row.ee_verification_contract_version,
    verified_metadata: verifiedMetadata,
    tool_capabilities: toolCapabilities,
    bootstrap_commands: normalizeStringArray(row.ee_bootstrap_commands),
    bootstrap_required_domains: normalizeStringArray(row.ee_bootstrap_required_domains),
    agent_hint: buildExecutionEnvironmentAgentHint({
      name: row.ee_name,
      image: row.ee_image,
      verifiedMetadata,
      toolCapabilities,
    }),
  };
}
