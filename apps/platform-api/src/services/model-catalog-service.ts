import { z } from 'zod';

import type { DatabasePool } from '../db/database.js';
import { TenantScopedRepository } from '../db/tenant-scoped-repository.js';
import { ConflictError, NotFoundError } from '../errors/domain-errors.js';
import { type DiscoveredModel, isDefaultEnabledModel } from './llm-discovery-service.js';

const createProviderSchema = z.object({
  name: z.string().min(1).max(100),
  baseUrl: z.string().url(),
  apiKeySecretRef: z.string().optional(),
  isEnabled: z.boolean().default(true),
  rateLimitRpm: z.number().int().positive().optional(),
  metadata: z.record(z.unknown()).default({}),
});

const updateProviderSchema = createProviderSchema.partial();

const reasoningConfigSchema = z.object({
  type: z.enum(['reasoning_effort', 'effort', 'thinking_level', 'thinking_budget']),
  options: z.array(z.string()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  default: z.union([z.string(), z.number()]),
}).nullable().default(null);

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
  endpointType: z.string().optional(),
  reasoningConfig: reasoningConfigSchema,
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
  endpoint_type: string | null;
  reasoning_config: Record<string, unknown> | null;
  created_at: Date;
  provider_name: string | null;
  auth_mode: string | null;
}

interface AssignmentRow {
  [key: string]: unknown;
  id: string;
  tenant_id: string;
  role_name: string;
  primary_model_id: string | null;
  reasoning_config: Record<string, unknown> | null;
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

    const existing = await this.pool.query<ProviderRow>(
      'SELECT * FROM llm_providers WHERE tenant_id = $1 AND name = $2',
      [tenantId, validated.name],
    );
    if (existing.rows.length > 0) {
      throw new ConflictError(`Provider "${validated.name}" already exists`);
    }

    const result = await this.pool.query<ProviderRow>(
      `INSERT INTO llm_providers
        (tenant_id, name, base_url, api_key_secret_ref, is_enabled, rate_limit_rpm, metadata)
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
    await this.pool.query(
      `UPDATE role_model_assignments SET primary_model_id = NULL
       WHERE tenant_id = $1 AND primary_model_id IN (
         SELECT id FROM llm_models WHERE tenant_id = $1 AND provider_id = $2
       )`,
      [tenantId, id],
    );

    await this.pool.query(
      'DELETE FROM llm_models WHERE tenant_id = $1 AND provider_id = $2',
      [tenantId, id],
    );

    const result = await this.pool.query(
      'DELETE FROM llm_providers WHERE tenant_id = $1 AND id = $2',
      [tenantId, id],
    );
    if (!result.rowCount) throw new NotFoundError('LLM provider not found');
  }

  async listModels(tenantId: string, providerId?: string): Promise<ModelRow[]> {
    const baseQuery = `
      SELECT m.*, p.name AS provider_name, p.auth_mode
      FROM llm_models m
      LEFT JOIN llm_providers p ON p.id = m.provider_id
      WHERE m.tenant_id = $1`;

    if (providerId) {
      const result = await this.pool.query<ModelRow>(
        `${baseQuery} AND m.provider_id = $2`,
        [tenantId, providerId],
      );
      return result.rows;
    }

    const result = await this.pool.query<ModelRow>(baseQuery, [tenantId]);
    return result.rows;
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
        supports_tool_use, supports_vision, input_cost_per_million_usd,
        output_cost_per_million_usd, is_enabled, endpoint_type, reasoning_config
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
        validated.endpointType ?? null,
        validated.reasoningConfig ? JSON.stringify(validated.reasoningConfig) : null,
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
      ['endpoint_type', validated.endpointType],
      ['reasoning_config', validated.reasoningConfig !== undefined
        ? (validated.reasoningConfig ? JSON.stringify(validated.reasoningConfig) : null)
        : undefined],
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

  async getSystemDefault(
    tenantId: string,
  ): Promise<{ modelId: string | null; reasoningConfig: Record<string, unknown> | null }> {
    const modelId = await this.findDefaultModelId(tenantId);
    const reasoningConfig = await this.findDefaultReasoningConfig(tenantId);
    return { modelId, reasoningConfig };
  }

  async setSystemDefault(
    tenantId: string,
    modelId: string | null,
    reasoningConfig: Record<string, unknown> | null,
  ): Promise<void> {
    await this.upsertRuntimeDefault(tenantId, 'default_model_id', modelId);
    await this.upsertRuntimeDefault(
      tenantId,
      'default_reasoning_config',
      reasoningConfig ? JSON.stringify(reasoningConfig) : null,
    );
  }

  async listAssignments(tenantId: string): Promise<AssignmentRow[]> {
    const repo = new TenantScopedRepository(this.pool, tenantId);
    return repo.findAll<AssignmentRow>('role_model_assignments', '*');
  }

  async upsertAssignment(
    tenantId: string,
    roleName: string,
    primaryModelId: string | null,
    reasoningConfig: Record<string, unknown> | null = null,
  ): Promise<AssignmentRow> {
    const result = await this.pool.query<AssignmentRow>(
      `INSERT INTO role_model_assignments
        (tenant_id, role_name, primary_model_id, reasoning_config)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, role_name)
       DO UPDATE SET primary_model_id = $3,
                     reasoning_config = $4, updated_at = NOW()
       RETURNING *`,
      [tenantId, roleName, primaryModelId,
       reasoningConfig ? JSON.stringify(reasoningConfig) : null],
    );
    return result.rows[0];
  }

  async bulkCreateModels(
    tenantId: string,
    providerId: string,
    models: DiscoveredModel[],
    enableAll = false,
  ): Promise<ModelRow[]> {
    const created: ModelRow[] = [];

    for (const model of models) {
      const result = await this.pool.query<ModelRow>(
        `INSERT INTO llm_models (
          tenant_id, provider_id, model_id, context_window,
          max_output_tokens, endpoint_type, reasoning_config,
          supports_tool_use, supports_vision,
          input_cost_per_million_usd, output_cost_per_million_usd,
          is_enabled
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (tenant_id, provider_id, model_id) DO UPDATE SET
          context_window = EXCLUDED.context_window,
          max_output_tokens = EXCLUDED.max_output_tokens,
          endpoint_type = EXCLUDED.endpoint_type,
          reasoning_config = EXCLUDED.reasoning_config,
          supports_tool_use = EXCLUDED.supports_tool_use,
          supports_vision = EXCLUDED.supports_vision,
          input_cost_per_million_usd = EXCLUDED.input_cost_per_million_usd,
          output_cost_per_million_usd = EXCLUDED.output_cost_per_million_usd
        RETURNING *`,
        [
          tenantId,
          providerId,
          model.modelId,
          model.contextWindow,
          model.maxOutputTokens,
          model.endpointType,
          model.reasoningConfig ? JSON.stringify(model.reasoningConfig) : null,
          model.supportsToolUse,
          model.supportsVision,
          model.inputCostPerMillionUsd,
          model.outputCostPerMillionUsd,
          enableAll || isDefaultEnabledModel(model.modelId),
        ],
      );
      if (result.rows[0]) created.push(result.rows[0]);
    }

    return created;
  }

  async resolveRoleConfig(
    tenantId: string,
    roleName: string,
  ): Promise<ResolvedRoleConfig | null> {
    const modelId = await this.findModelIdForRole(tenantId, roleName);
    if (!modelId) return null;

    return this.buildResolvedConfig(tenantId, roleName, modelId);
  }

  private async findModelIdForRole(
    tenantId: string,
    roleName: string,
  ): Promise<string | null> {
    const assignment = await this.findAssignment(tenantId, roleName);
    if (assignment?.primary_model_id) return assignment.primary_model_id;

    return this.findDefaultModelId(tenantId);
  }

  private async findAssignment(
    tenantId: string,
    roleName: string,
  ): Promise<AssignmentRow | null> {
    const repo = new TenantScopedRepository(this.pool, tenantId);
    const rows = await repo.findAll<AssignmentRow>(
      'role_model_assignments',
      '*',
      ['role_name = $2'],
      [roleName],
    );
    return rows[0] ?? null;
  }

  private async findDefaultModelId(tenantId: string): Promise<string | null> {
    return this.getRuntimeDefault(tenantId, 'default_model_id');
  }

  private async findDefaultReasoningConfig(
    tenantId: string,
  ): Promise<Record<string, unknown> | null> {
    const raw = await this.getRuntimeDefault(tenantId, 'default_reasoning_config');
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private async getRuntimeDefault(tenantId: string, key: string): Promise<string | null> {
    const repo = new TenantScopedRepository(this.pool, tenantId);
    const rows = await repo.findAll<{ config_value: string; [key: string]: unknown; tenant_id: string }>(
      'runtime_defaults',
      'config_value',
      ['config_key = $2'],
      [key],
    );
    return rows[0]?.config_value ?? null;
  }

  private async upsertRuntimeDefault(
    tenantId: string,
    key: string,
    value: string | null,
  ): Promise<void> {
    if (value === null) {
      await this.pool.query(
        'DELETE FROM runtime_defaults WHERE tenant_id = $1 AND config_key = $2',
        [tenantId, key],
      );
    } else {
      await this.pool.query(
        `INSERT INTO runtime_defaults (tenant_id, config_key, config_value, config_type)
         VALUES ($1, $2, $3, 'string')
         ON CONFLICT (tenant_id, config_key)
         DO UPDATE SET config_value = $3, updated_at = NOW()`,
        [tenantId, key, value],
      );
    }
  }

  private async buildResolvedConfig(
    tenantId: string,
    roleName: string,
    modelId: string,
  ): Promise<ResolvedRoleConfig> {
    const model = await this.getModel(tenantId, modelId);
    const provider = await this.getProvider(tenantId, model.provider_id);
    const assignment = await this.findAssignment(tenantId, roleName);

    const systemDefaultReasoning = await this.findDefaultReasoningConfig(tenantId);
    const reasoningConfig = assignment?.reasoning_config
      ?? systemDefaultReasoning
      ?? this.buildDefaultReasoningValue(model);

    const authMode = (provider.auth_mode as string) ?? 'api_key';

    const providerType = (provider.metadata?.providerType as string) ?? provider.name.toLowerCase();

    return {
      provider: {
        name: provider.name,
        providerType,
        baseUrl: provider.base_url,
        apiKeySecretRef: provider.api_key_secret_ref,
        authMode,
        providerId: authMode === 'oauth' ? provider.id : null,
      },
      model: {
        modelId: model.model_id,
        contextWindow: model.context_window,
        endpointType: model.endpoint_type,
        reasoningConfig: model.reasoning_config,
      },
      reasoningConfig,
    };
  }

  private buildDefaultReasoningValue(
    model: ModelRow,
  ): Record<string, unknown> | null {
    const schema = model.reasoning_config as Record<string, unknown> | null;
    if (!schema) return null;

    const type = schema.type as string;
    const defaultValue = schema.default;
    return { [type]: defaultValue };
  }
}

export interface ResolvedRoleConfig {
  provider: {
    name: string;
    providerType: string;
    baseUrl: string;
    apiKeySecretRef: string | null;
    authMode: string;
    providerId: string | null;
  };
  model: {
    modelId: string;
    contextWindow: number | null;
    endpointType: string | null;
    reasoningConfig: Record<string, unknown> | null;
  };
  reasoningConfig: Record<string, unknown> | null;
}
