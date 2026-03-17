import { z } from 'zod';

import type { DatabaseQueryable } from '../db/database.js';
import { TenantScopedRepository } from '../db/tenant-scoped-repository.js';
import { ConflictError, NotFoundError } from '../errors/domain-errors.js';
import { sanitizeSecretLikeValue } from './secret-redaction.js';

const createRoleSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  systemPrompt: z.string().optional(),
  allowedTools: z.array(z.string()).default([]),
  modelPreference: z.string().optional(),
  verificationStrategy: z.string().optional(),
  capabilities: z.array(z.string()).default([]),
  escalationTarget: z.string().max(100).nullable().optional(),
  maxEscalationDepth: z.number().int().min(1).max(10).default(5),
  isBuiltIn: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

const updateRoleSchema = createRoleSchema.partial().omit({ isBuiltIn: true });

export type CreateRoleInput = z.input<typeof createRoleSchema>;
export type UpdateRoleInput = z.input<typeof updateRoleSchema>;

interface RoleDefinitionRow {
  [key: string]: unknown;
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  system_prompt: string | null;
  allowed_tools: string[];
  model_preference: string | null;
  fallback_model?: string | null;
  verification_strategy: string | null;
  capabilities: string[];
  escalation_target: string | null;
  max_escalation_depth: number;
  is_built_in: boolean;
  is_active: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export class RoleDefinitionService {
  constructor(private readonly pool: DatabaseQueryable) {}

  async listRoles(tenantId: string, activeOnly = false): Promise<RoleDefinitionRow[]> {
    const repo = new TenantScopedRepository(this.pool, tenantId);
    const conditions = activeOnly ? ['is_active = $2'] : [];
    const values = activeOnly ? [true] : [];
    const rows = await repo.findAll<RoleDefinitionRow>('role_definitions', '*', conditions, values);
    return rows.map(sanitizeRoleDefinitionRow);
  }

  async getRoleByName(tenantId: string, name: string): Promise<RoleDefinitionRow | null> {
    const repo = new TenantScopedRepository(this.pool, tenantId);
    const rows = await repo.findAll<RoleDefinitionRow>(
      'role_definitions',
      '*',
      ['name = $2'],
      [name],
    );
    const row = rows[0] ?? null;
    return row ? sanitizeRoleDefinitionRow(row) : null;
  }

  async getRoleById(tenantId: string, id: string): Promise<RoleDefinitionRow> {
    const repo = new TenantScopedRepository(this.pool, tenantId);
    const row = await repo.findById<RoleDefinitionRow>('role_definitions', '*', id);
    if (!row) throw new NotFoundError('Role definition not found');
    return sanitizeRoleDefinitionRow(row);
  }

  async createRole(tenantId: string, input: CreateRoleInput): Promise<RoleDefinitionRow> {
    const validated = createRoleSchema.parse(input);

    const existing = await this.getRoleByName(tenantId, validated.name);
    if (existing) throw new ConflictError(`Role "${validated.name}" already exists`);

    const result = await this.pool.query<RoleDefinitionRow>(
      `INSERT INTO role_definitions (
        tenant_id, name, description, system_prompt, allowed_tools,
        model_preference, verification_strategy,
        capabilities, escalation_target, max_escalation_depth, is_built_in, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [
        tenantId,
        validated.name,
        validated.description ?? null,
        validated.systemPrompt ?? null,
        validated.allowedTools,
        validated.modelPreference ?? null,
        validated.verificationStrategy ?? null,
        validated.capabilities,
        validated.escalationTarget ?? null,
        validated.maxEscalationDepth,
        validated.isBuiltIn,
        validated.isActive,
      ],
    );

    return sanitizeRoleDefinitionRow(result.rows[0]);
  }

  async updateRole(tenantId: string, id: string, input: UpdateRoleInput): Promise<RoleDefinitionRow> {
    const validated = updateRoleSchema.parse(input);
    const current = await this.getRoleById(tenantId, id);

    const setClauses: string[] = [];
    const values: unknown[] = [tenantId, id];
    let paramIndex = 3;

    const fields: Array<[string, unknown]> = [
      ['name', validated.name],
      ['description', validated.description],
      ['system_prompt', validated.systemPrompt],
      ['allowed_tools', validated.allowedTools],
      ['model_preference', validated.modelPreference],
      ['verification_strategy', validated.verificationStrategy],
      ['capabilities', validated.capabilities],
      ['escalation_target', validated.escalationTarget],
      ['max_escalation_depth', validated.maxEscalationDepth],
      ['is_active', validated.isActive],
    ];

    for (const [column, value] of fields) {
      if (value !== undefined) {
        setClauses.push(`${column} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    }

    if (setClauses.length === 0) return current;

    setClauses.push(`version = version + 1`);
    setClauses.push(`updated_at = NOW()`);

    const result = await this.pool.query<RoleDefinitionRow>(
      `UPDATE role_definitions SET ${setClauses.join(', ')}
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      values,
    );

    if (!result.rowCount) throw new NotFoundError('Role definition not found');
    return sanitizeRoleDefinitionRow(result.rows[0]);
  }

  async deleteRole(tenantId: string, id: string): Promise<void> {
    const role = await this.getRoleById(tenantId, id);
    if (role.is_built_in) throw new ConflictError('Cannot delete built-in role');

    const playbooks = await this.findPlaybooksUsingRole(tenantId, role.name);
    if (playbooks.length > 0) {
      const names = playbooks.map((p) => p.name).join(', ');
      throw new ConflictError(`Cannot delete role "${role.name}" — used by playbook${playbooks.length > 1 ? 's' : ''}: ${names}`);
    }

    await this.pool.query(
      'DELETE FROM role_model_assignments WHERE tenant_id = $1 AND role_name = $2',
      [tenantId, role.name],
    );

    const result = await this.pool.query(
      'DELETE FROM role_definitions WHERE tenant_id = $1 AND id = $2',
      [tenantId, id],
    );
    if (!result.rowCount) throw new NotFoundError('Role definition not found');
  }

  private async findPlaybooksUsingRole(tenantId: string, roleName: string): Promise<Array<{ name: string }>> {
    const result = await this.pool.query<{ name: string }>(
      `SELECT name FROM playbooks WHERE tenant_id = $1 AND is_active = true AND definition->'roles' ? $2`,
      [tenantId, roleName],
    );
    return result.rows;
  }
}

const ROLE_DEFINITION_SECRET_REDACTION = 'redacted://role-definition-secret';

const REDACTION_OPTIONS = {
  redactionValue: ROLE_DEFINITION_SECRET_REDACTION,
  allowSecretReferences: false,
};

function sanitizeRoleDefinitionRow(row: RoleDefinitionRow): RoleDefinitionRow {
  const sanitized: RoleDefinitionRow = {
    ...row,
    system_prompt: sanitizeSecretLikeValue(row.system_prompt, REDACTION_OPTIONS) as string | null,
    description: sanitizeSecretLikeValue(row.description, REDACTION_OPTIONS) as string | null,
    model_preference: sanitizeSecretLikeValue(row.model_preference, REDACTION_OPTIONS) as string | null,
    verification_strategy: sanitizeSecretLikeValue(
      row.verification_strategy,
      REDACTION_OPTIONS,
    ) as string | null,
  };
  delete sanitized.fallback_model;
  return sanitized;
}
