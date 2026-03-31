import { z } from 'zod';

import type { DatabaseQueryable } from '../db/database.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/domain-errors.js';
import { normalizeStringArray } from './execution-environment/contract.js';
import {
  handleRoleWriteError,
  normalizeOptionalString,
  roleDefinitionSelectSql,
  sanitizeRoleDefinitionRow,
} from './role-definition/role-definition-records.js';
import type { RoleDefinitionQueryRow, RoleDefinitionRow } from './role-definition/role-definition-types.js';

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
export type { RoleDefinitionRow } from './role-definition/role-definition-types.js';

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
    const mcpServerIds = await this.normalizeRemoteMcpServerIds(tenantId, validated.mcpServerIds, null);
    const skillIds = await this.normalizeSkillIds(tenantId, validated.skillIds, null);

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
        : await this.normalizeRemoteMcpServerIds(tenantId, validated.mcpServerIds, id);
    const skillIds =
      validated.skillIds === undefined
        ? undefined
        : await this.normalizeSkillIds(tenantId, validated.skillIds, id);

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

  private async normalizeRemoteMcpServerIds(
    tenantId: string,
    ids: string[],
    roleId: string | null,
  ): Promise<string[]> {
    const uniqueIds = Array.from(new Set(ids));
    if (uniqueIds.length === 0) {
      return [];
    }
    const result = await this.pool.query<{
      id: string;
      is_archived: boolean;
      verification_status: string;
      already_assigned: boolean;
    }>(
      `SELECT s.id,
              s.is_archived,
              s.verification_status,
              EXISTS(
                SELECT 1
                  FROM specialist_mcp_server_grants g
                 WHERE g.specialist_id = $3
                   AND g.remote_mcp_server_id = s.id
              ) AS already_assigned
         FROM remote_mcp_servers s
        WHERE s.tenant_id = $1
          AND s.id = ANY($2::uuid[])`,
      [tenantId, uniqueIds, roleId],
    );
    if (result.rows.length !== uniqueIds.length) {
      throw new ValidationError('Remote MCP servers must exist before assignment');
    }
    const invalid = result.rows.find((row) =>
      !row.already_assigned && (row.is_archived || row.verification_status !== 'verified'),
    );
    if (invalid) {
      throw new ValidationError('Remote MCP servers must be active and verified before assignment');
    }
    return uniqueIds;
  }

  private async normalizeSkillIds(
    tenantId: string,
    ids: string[],
    roleId: string | null,
  ): Promise<string[]> {
    const uniqueIds = Array.from(new Set(ids));
    if (uniqueIds.length === 0) {
      return [];
    }
    const result = await this.pool.query<{
      id: string;
      is_archived: boolean;
      already_assigned: boolean;
    }>(
      `SELECT s.id,
              s.is_archived,
              EXISTS(
                SELECT 1
                  FROM specialist_skill_assignments a
                 WHERE a.specialist_id = $3
                   AND a.skill_id = s.id
              ) AS already_assigned
         FROM specialist_skills s
        WHERE s.tenant_id = $1
          AND s.id = ANY($2::uuid[])`,
      [tenantId, uniqueIds, roleId],
    );
    if (result.rows.length !== uniqueIds.length) {
      throw new ValidationError('Specialist skills must exist before assignment');
    }
    const invalid = result.rows.find((row) =>
      !row.already_assigned && row.is_archived,
    );
    if (invalid) {
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
