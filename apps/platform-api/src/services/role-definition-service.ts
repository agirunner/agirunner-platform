import { z } from 'zod';

import type { DatabaseQueryable } from '../db/database.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/domain-errors.js';
import { sanitizeSecretLikeValue } from './secret-redaction.js';
import {
  buildExecutionEnvironmentAgentHint,
  type ExecutionEnvironmentSummary,
  isRecord,
  normalizeStringArray,
} from './execution-environment-contract.js';

const createRoleSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  systemPrompt: z.string().optional(),
  allowedTools: z.array(z.string()).default([]),
  mcpServerIds: z.array(z.string().uuid()).default([]),
  skillIds: z.array(z.string().uuid()).default([]),
  modelPreference: z.string().optional(),
  verificationStrategy: z.string().optional(),
  escalationTarget: z.string().max(100).nullable().optional(),
  maxEscalationDepth: z.number().int().min(1).max(10).default(5),
  executionEnvironmentId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().default(true),
}).strict();

const updateRoleSchema = createRoleSchema.partial();

export type CreateRoleInput = z.input<typeof createRoleSchema>;
export type UpdateRoleInput = z.input<typeof updateRoleSchema>;

interface RoleDefinitionDbRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  system_prompt: string | null;
  allowed_tools: string[];
  model_preference: string | null;
  fallback_model?: string | null;
  verification_strategy: string | null;
  execution_environment_id: string | null;
  escalation_target: string | null;
  max_escalation_depth: number;
  is_active: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
}

interface ExecutionEnvironmentJoinRow {
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

type RoleDefinitionQueryRow = RoleDefinitionDbRow & ExecutionEnvironmentJoinRow;

export interface RoleDefinitionRow extends RoleDefinitionDbRow {
  execution_environment: ExecutionEnvironmentSummary | null;
  mcp_server_ids: string[];
  skill_ids: string[];
  mcp_servers: Array<Record<string, unknown>>;
  skills: Array<Record<string, unknown>>;
}

export class RoleDefinitionService {
  constructor(private readonly pool: DatabaseQueryable) {}

  async listRoles(tenantId: string, activeOnly = false): Promise<RoleDefinitionRow[]> {
    const result = await this.pool.query<RoleDefinitionQueryRow>(
      `${roleDefinitionSelectSql()}
       WHERE rd.tenant_id = $1
         ${activeOnly ? 'AND rd.is_active = true' : ''}
       ORDER BY rd.name ASC`,
      [tenantId],
    );
    return result.rows.map(sanitizeRoleDefinitionRow);
  }

  async getRoleByName(tenantId: string, name: string): Promise<RoleDefinitionRow | null> {
    const result = await this.pool.query<RoleDefinitionQueryRow>(
      `${roleDefinitionSelectSql()}
       WHERE rd.tenant_id = $1
         AND rd.name = $2
       LIMIT 1`,
      [tenantId, name.trim()],
    );
    const row = result.rows[0];
    return row ? sanitizeRoleDefinitionRow(row) : null;
  }

  async getRoleById(tenantId: string, id: string): Promise<RoleDefinitionRow> {
    const result = await this.pool.query<RoleDefinitionQueryRow>(
      `${roleDefinitionSelectSql()}
       WHERE rd.tenant_id = $1
         AND rd.id = $2
       LIMIT 1`,
      [tenantId, id],
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundError('Role definition not found');
    }
    return sanitizeRoleDefinitionRow(row);
  }

  async createRole(tenantId: string, input: CreateRoleInput): Promise<RoleDefinitionRow> {
    const validated = createRoleSchema.parse(input);
    const existing = await this.getRoleByName(tenantId, validated.name);
    if (existing) {
      throw new ConflictError(`Role "${validated.name}" already exists`);
    }

    const executionEnvironmentId = await this.normalizeExecutionEnvironmentId(
      tenantId,
      validated.executionEnvironmentId,
    );
    const mcpServerIds = await this.normalizeRemoteMcpServerIds(tenantId, validated.mcpServerIds);
    const skillIds = await this.normalizeSkillIds(tenantId, validated.skillIds);

    try {
      const result = await this.pool.query<{ id: string }>(
        `INSERT INTO role_definitions (
           tenant_id,
           name,
           description,
           system_prompt,
           allowed_tools,
           model_preference,
           verification_strategy,
           execution_environment_id,
           escalation_target,
           max_escalation_depth,
           is_active
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [
          tenantId,
          validated.name.trim(),
          normalizeOptionalString(validated.description),
          normalizeOptionalString(validated.systemPrompt),
          normalizeStringArray(validated.allowedTools),
          normalizeOptionalString(validated.modelPreference),
          normalizeOptionalString(validated.verificationStrategy),
          executionEnvironmentId,
          normalizeOptionalString(validated.escalationTarget ?? null),
          validated.maxEscalationDepth,
          validated.isActive,
        ],
      );
      if (mcpServerIds.length > 0) {
        await this.replaceRemoteMcpServerGrants(result.rows[0].id, mcpServerIds);
      }
      if (skillIds.length > 0) {
        await this.replaceSkillAssignments(result.rows[0].id, skillIds);
      }
      return this.getRoleById(tenantId, result.rows[0].id);
    } catch (error) {
      handleRoleWriteError(error);
      throw error;
    }
  }

  async updateRole(tenantId: string, id: string, input: UpdateRoleInput): Promise<RoleDefinitionRow> {
    const validated = updateRoleSchema.parse(input);
    const current = await this.getRoleById(tenantId, id);

    if (validated.name && validated.name.trim() !== current.name) {
      const existing = await this.getRoleByName(tenantId, validated.name);
      if (existing && existing.id !== id) {
        throw new ConflictError(`Role "${validated.name}" already exists`);
      }
    }

    const executionEnvironmentId =
      validated.executionEnvironmentId === undefined
        ? undefined
        : await this.normalizeExecutionEnvironmentId(tenantId, validated.executionEnvironmentId);
    const mcpServerIds =
      validated.mcpServerIds === undefined
        ? undefined
        : await this.normalizeRemoteMcpServerIds(tenantId, validated.mcpServerIds);
    const skillIds =
      validated.skillIds === undefined
        ? undefined
        : await this.normalizeSkillIds(tenantId, validated.skillIds);

    const setClauses: string[] = [];
    const values: unknown[] = [tenantId, id];
    let paramIndex = 3;
    const fields: Array<[string, unknown]> = [
      ['name', normalizeOptionalString(validated.name)],
      ['description', normalizeOptionalString(validated.description)],
      ['system_prompt', normalizeOptionalString(validated.systemPrompt)],
      ['allowed_tools', validated.allowedTools === undefined ? undefined : normalizeStringArray(validated.allowedTools)],
      ['model_preference', normalizeOptionalString(validated.modelPreference)],
      ['verification_strategy', normalizeOptionalString(validated.verificationStrategy)],
      ['execution_environment_id', executionEnvironmentId],
      ['escalation_target', normalizeOptionalString(validated.escalationTarget)],
      ['max_escalation_depth', validated.maxEscalationDepth],
      ['is_active', validated.isActive],
    ];

    for (const [column, value] of fields) {
      if (value !== undefined) {
        setClauses.push(`${column} = $${paramIndex}`);
        values.push(value);
        paramIndex += 1;
      }
    }

    if (setClauses.length === 0 && mcpServerIds === undefined && skillIds === undefined) {
      return current;
    }

    if (setClauses.length > 0) {
      setClauses.push('version = version + 1');
      setClauses.push('updated_at = now()');

      try {
        const result = await this.pool.query(
          `UPDATE role_definitions
              SET ${setClauses.join(', ')}
            WHERE tenant_id = $1
              AND id = $2
            RETURNING id`,
          values,
        );
        if (!result.rowCount) {
          throw new NotFoundError('Role definition not found');
        }
      } catch (error) {
        handleRoleWriteError(error);
        throw error;
      }
    }

    if (mcpServerIds !== undefined) {
      await this.replaceRemoteMcpServerGrants(id, mcpServerIds);
    }
    if (skillIds !== undefined) {
      await this.replaceSkillAssignments(id, skillIds);
    }

    return this.getRoleById(tenantId, id);
  }

  async deleteRole(tenantId: string, id: string): Promise<void> {
    const role = await this.getRoleById(tenantId, id);

    const playbooks = await this.findPlaybooksUsingRole(tenantId, role.name);
    if (playbooks.length > 0) {
      const names = playbooks.map((entry) => entry.name).join(', ');
      throw new ConflictError(
        `Cannot delete role "${role.name}" — used by playbook${playbooks.length > 1 ? 's' : ''}: ${names}`,
      );
    }

    const workflowPlaybooks = await this.findWorkflowReferencedPlaybooksUsingRole(
      tenantId,
      role.name,
    );
    if (workflowPlaybooks.length > 0) {
      const names = workflowPlaybooks.map((entry) => entry.name).join(', ');
      throw new ConflictError(
        `Cannot delete role "${role.name}" — referenced by workflow playbook version${workflowPlaybooks.length > 1 ? 's' : ''}: ${names}`,
      );
    }

    await this.pool.query(
      'DELETE FROM role_model_assignments WHERE tenant_id = $1 AND role_name = $2',
      [tenantId, role.name],
    );
    await this.pool.query('DELETE FROM specialist_mcp_server_grants WHERE specialist_id = $1', [id]);
    await this.pool.query('DELETE FROM specialist_skill_assignments WHERE specialist_id = $1', [id]);

    const result = await this.pool.query(
      'DELETE FROM role_definitions WHERE tenant_id = $1 AND id = $2',
      [tenantId, id],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Role definition not found');
    }
  }

  private async normalizeExecutionEnvironmentId(
    tenantId: string,
    requestedId: string | null | undefined,
  ): Promise<string | null | undefined> {
    if (requestedId === undefined) {
      return undefined;
    }
    if (requestedId === null) {
      return null;
    }
    const environmentId = requestedId.trim();
    if (environmentId.length === 0) {
      return null;
    }
    const result = await this.pool.query<{ id: string }>(
      `SELECT ee.id
         FROM execution_environments ee
         LEFT JOIN execution_environment_catalog c
           ON c.catalog_key = ee.catalog_key
          AND c.catalog_version = ee.catalog_version
        WHERE ee.tenant_id = $1
          AND ee.id = $2
          AND ee.is_archived = false
          AND ee.is_claimable = true
          AND COALESCE(c.support_status, 'active') <> 'blocked'
        LIMIT 1`,
      [tenantId, environmentId],
    );
    if (!result.rowCount) {
      throw new ValidationError('Execution environment must reference a claimable, unarchived environment');
    }
    return environmentId;
  }

  private async findPlaybooksUsingRole(tenantId: string, roleName: string): Promise<Array<{ name: string }>> {
    const result = await this.pool.query<{ name: string }>(
      `SELECT name
         FROM playbooks
        WHERE tenant_id = $1
          AND is_active = true
          AND definition->'roles' ? $2`,
      [tenantId, roleName],
    );
    return result.rows;
  }

  private async findWorkflowReferencedPlaybooksUsingRole(
    tenantId: string,
    roleName: string,
  ): Promise<Array<{ name: string }>> {
    const result = await this.pool.query<{ name: string }>(
      `SELECT DISTINCT p.name
         FROM workflows w
         JOIN playbooks p
           ON p.tenant_id = w.tenant_id
          AND p.id = w.playbook_id
        WHERE w.tenant_id = $1
          AND p.definition->'roles' ? $2`,
      [tenantId, roleName],
    );
    return result.rows;
  }

  private async normalizeRemoteMcpServerIds(tenantId: string, ids: string[]): Promise<string[]> {
    const uniqueIds = Array.from(new Set(ids));
    if (uniqueIds.length === 0) {
      return [];
    }
    const result = await this.pool.query<{ id: string }>(
      `SELECT id
         FROM remote_mcp_servers
        WHERE tenant_id = $1
          AND is_archived = false
          AND verification_status = 'verified'
          AND id = ANY($2::uuid[])`,
      [tenantId, uniqueIds],
    );
    if (result.rows.length !== uniqueIds.length) {
      throw new ValidationError('Remote MCP servers must be active and verified before assignment');
    }
    return uniqueIds;
  }

  private async normalizeSkillIds(tenantId: string, ids: string[]): Promise<string[]> {
    const uniqueIds = Array.from(new Set(ids));
    if (uniqueIds.length === 0) {
      return [];
    }
    const result = await this.pool.query<{ id: string }>(
      `SELECT id
         FROM specialist_skills
        WHERE tenant_id = $1
          AND is_archived = false
          AND id = ANY($2::uuid[])`,
      [tenantId, uniqueIds],
    );
    if (result.rows.length !== uniqueIds.length) {
      throw new ValidationError('Specialist skills must be active before assignment');
    }
    return uniqueIds;
  }

  private async replaceRemoteMcpServerGrants(roleId: string, ids: string[]): Promise<void> {
    await this.pool.query('DELETE FROM specialist_mcp_server_grants WHERE specialist_id = $1', [roleId]);
    for (const remoteMcpServerId of ids) {
      await this.pool.query(
        `INSERT INTO specialist_mcp_server_grants (specialist_id, remote_mcp_server_id)
         VALUES ($1, $2)`,
        [roleId, remoteMcpServerId],
      );
    }
  }

  private async replaceSkillAssignments(roleId: string, skillIds: string[]): Promise<void> {
    await this.pool.query('DELETE FROM specialist_skill_assignments WHERE specialist_id = $1', [roleId]);
    for (const [index, skillId] of skillIds.entries()) {
      await this.pool.query(
        `INSERT INTO specialist_skill_assignments (specialist_id, skill_id, sort_order)
         VALUES ($1, $2, $3)`,
        [roleId, skillId, index],
      );
    }
  }
}

function roleDefinitionSelectSql(): string {
  return `SELECT
    rd.*,
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

const ROLE_DEFINITION_SECRET_REDACTION = 'redacted://role-definition-secret';

const REDACTION_OPTIONS = {
  redactionValue: ROLE_DEFINITION_SECRET_REDACTION,
  allowSecretReferences: false,
};

function sanitizeRoleDefinitionRow(row: RoleDefinitionQueryRow): RoleDefinitionRow {
  const executionEnvironment = buildExecutionEnvironmentSummary(row);
  const sanitized: RoleDefinitionRow = {
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
    execution_environment: executionEnvironment,
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
  delete sanitized.fallback_model;
  return sanitized;
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

function normalizeOptionalString(value: string | null | undefined): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function handleRoleWriteError(error: unknown): void {
  if (!error || typeof error !== 'object') {
    return;
  }
  const pgError = error as { code?: string; constraint?: string };
  if (pgError.code === '23505') {
    throw new ConflictError('Role definition already exists');
  }
}
