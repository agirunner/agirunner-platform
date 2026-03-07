import { z } from 'zod';

import type { DatabasePool } from '../db/database.js';
import { TenantScopedRepository } from '../db/tenant-scoped-repository.js';
import { ConflictError, NotFoundError } from '../errors/domain-errors.js';

const CONFIG_TYPES = ['string', 'number', 'boolean', 'json'] as const;

const createDefaultSchema = z.object({
  configKey: z.string().min(1).max(200),
  configValue: z.string(),
  configType: z.enum(CONFIG_TYPES),
  description: z.string().max(1000).optional(),
});

const updateDefaultSchema = createDefaultSchema.partial().omit({ configKey: true });

export type CreateRuntimeDefaultInput = z.infer<typeof createDefaultSchema>;
export type UpdateRuntimeDefaultInput = z.infer<typeof updateDefaultSchema>;

interface RuntimeDefaultRow {
  [key: string]: unknown;
  id: string;
  tenant_id: string;
  config_key: string;
  config_value: string;
  config_type: string;
  description: string | null;
  created_at: Date;
  updated_at: Date;
}

export class RuntimeDefaultsService {
  constructor(private readonly pool: DatabasePool) {}

  async listDefaults(tenantId: string): Promise<RuntimeDefaultRow[]> {
    const repo = new TenantScopedRepository(this.pool, tenantId);
    return repo.findAll<RuntimeDefaultRow>('runtime_defaults', '*');
  }

  async getDefault(tenantId: string, id: string): Promise<RuntimeDefaultRow> {
    const repo = new TenantScopedRepository(this.pool, tenantId);
    const row = await repo.findById<RuntimeDefaultRow>('runtime_defaults', '*', id);
    if (!row) throw new NotFoundError('Runtime default not found');
    return row;
  }

  async getByKey(tenantId: string, configKey: string): Promise<RuntimeDefaultRow | null> {
    const repo = new TenantScopedRepository(this.pool, tenantId);
    const rows = await repo.findAll<RuntimeDefaultRow>(
      'runtime_defaults',
      '*',
      ['config_key = $2'],
      [configKey],
    );
    return rows[0] ?? null;
  }

  async createDefault(tenantId: string, input: CreateRuntimeDefaultInput): Promise<RuntimeDefaultRow> {
    const validated = createDefaultSchema.parse(input);

    const existing = await this.getByKey(tenantId, validated.configKey);
    if (existing) throw new ConflictError(`Runtime default "${validated.configKey}" already exists`);

    const result = await this.pool.query<RuntimeDefaultRow>(
      `INSERT INTO runtime_defaults (tenant_id, config_key, config_value, config_type, description)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        tenantId,
        validated.configKey,
        validated.configValue,
        validated.configType,
        validated.description ?? null,
      ],
    );
    return result.rows[0];
  }

  async updateDefault(tenantId: string, id: string, input: UpdateRuntimeDefaultInput): Promise<RuntimeDefaultRow> {
    const validated = updateDefaultSchema.parse(input);
    const setClauses: string[] = [];
    const values: unknown[] = [tenantId, id];
    let paramIndex = 3;

    const fields: Array<[string, unknown]> = [
      ['config_value', validated.configValue],
      ['config_type', validated.configType],
      ['description', validated.description],
    ];

    for (const [column, value] of fields) {
      if (value !== undefined) {
        setClauses.push(`${column} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    }

    if (setClauses.length === 0) return this.getDefault(tenantId, id);

    setClauses.push('updated_at = NOW()');

    const result = await this.pool.query<RuntimeDefaultRow>(
      `UPDATE runtime_defaults SET ${setClauses.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      values,
    );
    if (!result.rowCount) throw new NotFoundError('Runtime default not found');
    return result.rows[0];
  }

  async upsertDefault(tenantId: string, input: CreateRuntimeDefaultInput): Promise<RuntimeDefaultRow> {
    const validated = createDefaultSchema.parse(input);

    const result = await this.pool.query<RuntimeDefaultRow>(
      `INSERT INTO runtime_defaults (tenant_id, config_key, config_value, config_type, description)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, config_key)
       DO UPDATE SET config_value = $3, config_type = $4, description = $5, updated_at = NOW()
       RETURNING *`,
      [
        tenantId,
        validated.configKey,
        validated.configValue,
        validated.configType,
        validated.description ?? null,
      ],
    );
    return result.rows[0];
  }

  async deleteDefault(tenantId: string, id: string): Promise<void> {
    const result = await this.pool.query(
      'DELETE FROM runtime_defaults WHERE tenant_id = $1 AND id = $2',
      [tenantId, id],
    );
    if (!result.rowCount) throw new NotFoundError('Runtime default not found');
  }
}
