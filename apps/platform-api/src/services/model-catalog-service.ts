import { z } from 'zod';

import type { DatabasePool } from '../db/database.js';
import { TenantScopedRepository } from '../db/tenant-scoped-repository.js';
import { ConflictError, NotFoundError } from '../errors/domain-errors.js';

const createProviderSchema = z.object({
  name: z.string().min(1).max(100),
  baseUrl: z.string().url(),
  apiKeySecretRef: z.string().optional(),
  isEnabled: z.boolean().default(true),
  rateLimitRpm: z.number().int().positive().optional(),
  metadata: z.record(z.unknown()).default({}),
});

const updateProviderSchema = createProviderSchema.partial();

const createModelSchema = z.object({
  providerId: z.string().uuid(),
  modelId: z.string().min(1).max(200),
  contextWindow: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  supportsToolUse: z.boolean().default(true),
  supportsVision: z.boolean().default(false),
  inputCostPerMillionUsd: z.number().nonnegative().optional(),
  outputCostPerMillionUsd: z.number().nonnegative().optional(),
  isEnabled: z.boolean().default(true),
});

const updateModelSchema = createModelSchema.partial().omit({ providerId: true });

export type CreateProviderInput = z.infer<typeof createProviderSchema>;
export type UpdateProviderInput = z.infer<typeof updateProviderSchema>;
export type CreateModelInput = z.infer<typeof createModelSchema>;
export type UpdateModelInput = z.infer<typeof updateModelSchema>;

interface ProviderRow {
  [key: string]: unknown;
  id: string;
  tenant_id: string;
  name: string;
  base_url: string;
  api_key_secret_ref: string | null;
  is_enabled: boolean;
  rate_limit_rpm: number | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

interface ModelRow {
  [key: string]: unknown;
  id: string;
  tenant_id: string;
  provider_id: string;
  model_id: string;
  context_window: number | null;
  max_output_tokens: number | null;
  supports_tool_use: boolean;
  supports_vision: boolean;
  input_cost_per_million_usd: string | null;
  output_cost_per_million_usd: string | null;
  is_enabled: boolean;
  created_at: Date;
}

interface AssignmentRow {
  [key: string]: unknown;
  id: string;
  tenant_id: string;
  role_name: string;
  primary_model_id: string | null;
  fallback_model_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export class ModelCatalogService {
  constructor(private readonly pool: DatabasePool) {}

  async listProviders(tenantId: string): Promise<ProviderRow[]> {
    const repo = new TenantScopedRepository(this.pool, tenantId);
    return repo.findAll<ProviderRow>('llm_providers', '*');
  }

  async getProvider(tenantId: string, id: string): Promise<ProviderRow> {
    const repo = new TenantScopedRepository(this.pool, tenantId);
    const row = await repo.findById<ProviderRow>('llm_providers', '*', id);
    if (!row) throw new NotFoundError('LLM provider not found');
    return row;
  }

  async createProvider(tenantId: string, input: CreateProviderInput): Promise<ProviderRow> {
    const validated = createProviderSchema.parse(input);

    const result = await this.pool.query<ProviderRow>(
      `INSERT INTO llm_providers (tenant_id, name, base_url, api_key_secret_ref, is_enabled, rate_limit_rpm, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        tenantId,
        validated.name,
        validated.baseUrl,
        validated.apiKeySecretRef ?? null,
        validated.isEnabled,
        validated.rateLimitRpm ?? null,
        validated.metadata,
      ],
    );
    return result.rows[0];
  }

  async updateProvider(tenantId: string, id: string, input: UpdateProviderInput): Promise<ProviderRow> {
    const validated = updateProviderSchema.parse(input);
    const setClauses: string[] = [];
    const values: unknown[] = [tenantId, id];
    let paramIndex = 3;

    const fields: Array<[string, unknown]> = [
      ['name', validated.name],
      ['base_url', validated.baseUrl],
      ['api_key_secret_ref', validated.apiKeySecretRef],
      ['is_enabled', validated.isEnabled],
      ['rate_limit_rpm', validated.rateLimitRpm],
      ['metadata', validated.metadata ? JSON.stringify(validated.metadata) : undefined],
    ];

    for (const [column, value] of fields) {
      if (value !== undefined) {
        setClauses.push(`${column} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    }

    if (setClauses.length === 0) return this.getProvider(tenantId, id);

    setClauses.push('updated_at = NOW()');

    const result = await this.pool.query<ProviderRow>(
      `UPDATE llm_providers SET ${setClauses.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      values,
    );
    if (!result.rowCount) throw new NotFoundError('LLM provider not found');
    return result.rows[0];
  }

  async deleteProvider(tenantId: string, id: string): Promise<void> {
    const modelCount = await this.pool.query(
      'SELECT COUNT(*) as count FROM llm_models WHERE tenant_id = $1 AND provider_id = $2',
      [tenantId, id],
    );
    if (Number(modelCount.rows[0].count) > 0) {
      throw new ConflictError('Cannot delete provider with active models');
    }

    const result = await this.pool.query(
      'DELETE FROM llm_providers WHERE tenant_id = $1 AND id = $2',
      [tenantId, id],
    );
    if (!result.rowCount) throw new NotFoundError('LLM provider not found');
  }

  async listModels(tenantId: string, providerId?: string): Promise<ModelRow[]> {
    const repo = new TenantScopedRepository(this.pool, tenantId);
    if (providerId) {
      return repo.findAll<ModelRow>('llm_models', '*', ['provider_id = $2'], [providerId]);
    }
    return repo.findAll<ModelRow>('llm_models', '*');
  }

  async getModel(tenantId: string, id: string): Promise<ModelRow> {
    const repo = new TenantScopedRepository(this.pool, tenantId);
    const row = await repo.findById<ModelRow>('llm_models', '*', id);
    if (!row) throw new NotFoundError('LLM model not found');
    return row;
  }

  async createModel(tenantId: string, input: CreateModelInput): Promise<ModelRow> {
    const validated = createModelSchema.parse(input);

    await this.getProvider(tenantId, validated.providerId);

    const result = await this.pool.query<ModelRow>(
      `INSERT INTO llm_models (
        tenant_id, provider_id, model_id, context_window, max_output_tokens,
        supports_tool_use, supports_vision, input_cost_per_million_usd, output_cost_per_million_usd, is_enabled
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        tenantId,
        validated.providerId,
        validated.modelId,
        validated.contextWindow ?? null,
        validated.maxOutputTokens ?? null,
        validated.supportsToolUse,
        validated.supportsVision,
        validated.inputCostPerMillionUsd ?? null,
        validated.outputCostPerMillionUsd ?? null,
        validated.isEnabled,
      ],
    );
    return result.rows[0];
  }

  async updateModel(tenantId: string, id: string, input: UpdateModelInput): Promise<ModelRow> {
    const validated = updateModelSchema.parse(input);
    const setClauses: string[] = [];
    const values: unknown[] = [tenantId, id];
    let paramIndex = 3;

    const fields: Array<[string, unknown]> = [
      ['model_id', validated.modelId],
      ['context_window', validated.contextWindow],
      ['max_output_tokens', validated.maxOutputTokens],
      ['supports_tool_use', validated.supportsToolUse],
      ['supports_vision', validated.supportsVision],
      ['input_cost_per_million_usd', validated.inputCostPerMillionUsd],
      ['output_cost_per_million_usd', validated.outputCostPerMillionUsd],
      ['is_enabled', validated.isEnabled],
    ];

    for (const [column, value] of fields) {
      if (value !== undefined) {
        setClauses.push(`${column} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    }

    if (setClauses.length === 0) return this.getModel(tenantId, id);

    const result = await this.pool.query<ModelRow>(
      `UPDATE llm_models SET ${setClauses.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      values,
    );
    if (!result.rowCount) throw new NotFoundError('LLM model not found');
    return result.rows[0];
  }

  async deleteModel(tenantId: string, id: string): Promise<void> {
    const result = await this.pool.query(
      'DELETE FROM llm_models WHERE tenant_id = $1 AND id = $2',
      [tenantId, id],
    );
    if (!result.rowCount) throw new NotFoundError('LLM model not found');
  }

  async listAssignments(tenantId: string): Promise<AssignmentRow[]> {
    const repo = new TenantScopedRepository(this.pool, tenantId);
    return repo.findAll<AssignmentRow>('role_model_assignments', '*');
  }

  async upsertAssignment(
    tenantId: string,
    roleName: string,
    primaryModelId: string | null,
    fallbackModelId: string | null,
  ): Promise<AssignmentRow> {
    const result = await this.pool.query<AssignmentRow>(
      `INSERT INTO role_model_assignments (tenant_id, role_name, primary_model_id, fallback_model_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, role_name)
       DO UPDATE SET primary_model_id = $3, fallback_model_id = $4, updated_at = NOW()
       RETURNING *`,
      [tenantId, roleName, primaryModelId, fallbackModelId],
    );
    return result.rows[0];
  }
}
