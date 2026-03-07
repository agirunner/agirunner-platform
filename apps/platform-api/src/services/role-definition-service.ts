import { z } from 'zod';

import type { DatabasePool } from '../db/database.js';
import { TenantScopedRepository } from '../db/tenant-scoped-repository.js';
import { ConflictError, NotFoundError } from '../errors/domain-errors.js';

const createRoleSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  systemPrompt: z.string().optional(),
  allowedTools: z.array(z.string()).default([]),
  modelPreference: z.string().optional(),
  fallbackModel: z.string().optional(),
  verificationStrategy: z.string().optional(),
  capabilities: z.array(z.string()).default([]),
  isBuiltIn: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

const updateRoleSchema = createRoleSchema.partial().omit({ isBuiltIn: true });

export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

interface RoleDefinitionRow {
  [key: string]: unknown;
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  system_prompt: string | null;
  allowed_tools: string[];
  model_preference: string | null;
  fallback_model: string | null;
  verification_strategy: string | null;
  capabilities: string[];
  is_built_in: boolean;
  is_active: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export class RoleDefinitionService {
  constructor(private readonly pool: DatabasePool) {}

  async listRoles(tenantId: string, activeOnly = false): Promise<RoleDefinitionRow[]> {
    const repo = new TenantScopedRepository(this.pool, tenantId);
    const conditions = activeOnly ? ['is_active = $2'] : [];
    const values = activeOnly ? [true] : [];
    return repo.findAll<RoleDefinitionRow>('role_definitions', '*', conditions, values);
  }

  async getRoleByName(tenantId: string, name: string): Promise<RoleDefinitionRow | null> {
    const repo = new TenantScopedRepository(this.pool, tenantId);
    const rows = await repo.findAll<RoleDefinitionRow>(
      'role_definitions',
      '*',
      ['name = $2'],
      [name],
    );
    return rows[0] ?? null;
  }

  async getRoleById(tenantId: string, id: string): Promise<RoleDefinitionRow> {
    const repo = new TenantScopedRepository(this.pool, tenantId);
    const row = await repo.findById<RoleDefinitionRow>('role_definitions', '*', id);
    if (!row) throw new NotFoundError('Role definition not found');
    return row;
  }

  async createRole(tenantId: string, input: CreateRoleInput): Promise<RoleDefinitionRow> {
    const validated = createRoleSchema.parse(input);

    const existing = await this.getRoleByName(tenantId, validated.name);
    if (existing) throw new ConflictError(`Role "${validated.name}" already exists`);

    const result = await this.pool.query<RoleDefinitionRow>(
      `INSERT INTO role_definitions (
        tenant_id, name, description, system_prompt, allowed_tools,
        model_preference, fallback_model, verification_strategy,
        capabilities, is_built_in, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        tenantId,
        validated.name,
        validated.description ?? null,
        validated.systemPrompt ?? null,
        validated.allowedTools,
        validated.modelPreference ?? null,
        validated.fallbackModel ?? null,
        validated.verificationStrategy ?? null,
        validated.capabilities,
        validated.isBuiltIn,
        validated.isActive,
      ],
    );

    return result.rows[0];
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
      ['fallback_model', validated.fallbackModel],
      ['verification_strategy', validated.verificationStrategy],
      ['capabilities', validated.capabilities],
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
    return result.rows[0];
  }

  async deleteRole(tenantId: string, id: string): Promise<void> {
    const role = await this.getRoleById(tenantId, id);
    if (role.is_built_in) throw new ConflictError('Cannot delete built-in role');

    const result = await this.pool.query(
      'DELETE FROM role_definitions WHERE tenant_id = $1 AND id = $2',
      [tenantId, id],
    );
    if (!result.rowCount) throw new NotFoundError('Role definition not found');
  }
}
