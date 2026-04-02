import type { DatabasePool } from '../../db/database.js';
import { TenantScopedRepository } from '../../db/tenant-scoped-repository.js';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/domain-errors.js';
import { readProviderSecret } from '../../lib/oauth-crypto.js';
import {
  type DiscoveredModel,
  isDefaultEnabledModel,
  readNativeSearchCapability,
} from '../platform-config/llm-discovery-service.js';
import {
  attachNativeSearchCapability,
  normalizeSecretValue,
  parseNullableCost,
  type AssignmentRow,
  type ModelRow,
  type ProviderRecord,
  type ProviderRow,
  type ResolvedRoleConfig,
  readProviderTypeOrThrow,
  sanitizeProvider,
} from './model-catalog-records.js';
import {
  createModelSchema,
  createProviderSchema,
  type CreateModelInput,
  type CreateProviderInput,
  type UpdateModelInput,
  type UpdateProviderInput,
  updateModelSchema,
  updateProviderSchema,
} from './model-catalog-schemas.js';
import {
  findDefaultModelId,
  findDefaultReasoningConfig,
  upsertRuntimeDefault,
} from './model-catalog-runtime-defaults.js';

export type {
  AssignmentRow,
  CreateModelInput,
  CreateProviderInput,
  ModelRow,
  ProviderRecord,
  ProviderRow,
  ResolvedRoleConfig,
  UpdateModelInput,
  UpdateProviderInput,
};

export class ModelCatalogService {
  constructor(private readonly pool: DatabasePool) {}

  async listProviders(tenantId: string): Promise<ProviderRecord[]> {
    const repo = new TenantScopedRepository(this.pool, tenantId);
    const providers = await repo.findAll<ProviderRow>('llm_providers', '*');
    return providers.map((provider) => sanitizeProvider(provider));
  }

  async getProvider(tenantId: string, id: string): Promise<ProviderRecord> {
    return sanitizeProvider(await this.getStoredProvider(tenantId, id));
  }

  async createProvider(tenantId: string, input: CreateProviderInput): Promise<ProviderRecord> {
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
        normalizeSecretValue(validated.apiKeySecretRef),
        validated.isEnabled,
        validated.rateLimitRpm ?? null,
        validated.metadata,
      ],
    );
    return sanitizeProvider(result.rows[0]);
  }

  async updateProvider(tenantId: string, id: string, input: UpdateProviderInput): Promise<ProviderRecord> {
    const validated = updateProviderSchema.parse(input);
    const setClauses: string[] = [];
    const values: unknown[] = [tenantId, id];
    let paramIndex = 3;

    const fields: Array<[string, unknown]> = [
      ['name', validated.name],
      ['base_url', validated.baseUrl],
      ['api_key_secret_ref', validated.apiKeySecretRef === undefined ? undefined : normalizeSecretValue(validated.apiKeySecretRef)],
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
    return sanitizeProvider(result.rows[0]);
  }

  async deleteProvider(tenantId: string, id: string): Promise<void> {
    const providerModels = await this.pool.query<{ id: string }>(
      'SELECT id FROM llm_models WHERE tenant_id = $1 AND provider_id = $2',
      [tenantId, id],
    );
    await this.clearDeletedModelReferences(
      tenantId,
      providerModels.rows.map((row) => row.id),
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
      return result.rows.map(attachNativeSearchCapability);
    }

    const result = await this.pool.query<ModelRow>(baseQuery, [tenantId]);
    return result.rows.map(attachNativeSearchCapability);
  }

  async getModel(tenantId: string, id: string): Promise<ModelRow> {
    const repo = new TenantScopedRepository(this.pool, tenantId);
    const row = await repo.findById<ModelRow>('llm_models', '*', id);
    if (!row) throw new NotFoundError('LLM model not found');
    return row;
  }

  async createModel(tenantId: string, input: CreateModelInput): Promise<ModelRow> {
    const validated = createModelSchema.parse(input);

    await this.getStoredProvider(tenantId, validated.providerId);
    if (validated.isEnabled) {
      assertModelCanBeEnabled({
        contextWindow: validated.contextWindow,
        maxOutputTokens: validated.maxOutputTokens,
      });
    }

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
    const shouldValidateEnablement =
      validated.isEnabled === true ||
      validated.contextWindow !== undefined ||
      validated.maxOutputTokens !== undefined;

    if (shouldValidateEnablement) {
      const current = await this.getModel(tenantId, id);
      const nextIsEnabled = validated.isEnabled ?? current.is_enabled !== false;
      if (nextIsEnabled) {
        assertModelCanBeEnabled({
          contextWindow: validated.contextWindow ?? current.context_window,
          maxOutputTokens: validated.maxOutputTokens ?? current.max_output_tokens,
        });
      }
    }

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
    await this.clearDeletedModelReferences(tenantId, [id]);
    const result = await this.pool.query(
      'DELETE FROM llm_models WHERE tenant_id = $1 AND id = $2',
      [tenantId, id],
    );
    if (!result.rowCount) throw new NotFoundError('LLM model not found');
  }

  async getSystemDefault(
    tenantId: string,
  ): Promise<{ modelId: string | null; reasoningConfig: Record<string, unknown> | null }> {
    const modelId = await findDefaultModelId(this.pool, tenantId);
    const reasoningConfig = await findDefaultReasoningConfig(this.pool, tenantId);
    return { modelId, reasoningConfig };
  }

  async setSystemDefault(
    tenantId: string,
    modelId: string | null,
    reasoningConfig: Record<string, unknown> | null,
  ): Promise<void> {
    await upsertRuntimeDefault(this.pool, tenantId, 'default_model_id', modelId);
    await upsertRuntimeDefault(
      this.pool,
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
  ): Promise<AssignmentRow | null> {
    if (!primaryModelId && !reasoningConfig) {
      await this.pool.query(
        'DELETE FROM role_model_assignments WHERE tenant_id = $1 AND role_name = $2',
        [tenantId, roleName],
      );
      return null;
    }

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
      const canEnableModel = hasRequiredModelLimits({
        contextWindow: model.contextWindow,
        maxOutputTokens: model.maxOutputTokens,
      });
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
          canEnableModel && (enableAll || isDefaultEnabledModel(model.modelId)),
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

    return findDefaultModelId(this.pool, tenantId);
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

  private async clearDeletedModelReferences(tenantId: string, modelIds: string[]): Promise<void> {
    if (modelIds.length === 0) {
      return;
    }

    await this.pool.query(
      'UPDATE role_model_assignments SET primary_model_id = NULL WHERE tenant_id = $1 AND primary_model_id = ANY($2::uuid[])',
      [tenantId, modelIds],
    );

    const clearedDefaultModel = await this.pool.query(
      'DELETE FROM runtime_defaults WHERE tenant_id = $1 AND config_key = $2 AND config_value = ANY($3::text[])',
      [tenantId, 'default_model_id', modelIds],
    );

    if ((clearedDefaultModel.rowCount ?? 0) > 0) {
      await this.pool.query(
        'DELETE FROM runtime_defaults WHERE tenant_id = $1 AND config_key = $2',
        [tenantId, 'default_reasoning_config'],
      );
    }
  }

  private async buildResolvedConfig(
    tenantId: string,
    roleName: string,
    modelId: string,
  ): Promise<ResolvedRoleConfig> {
    const model = await this.getModel(tenantId, modelId);
    const provider = await this.getStoredProvider(tenantId, model.provider_id);
    const assignment = await this.findAssignment(tenantId, roleName);

    const systemDefaultReasoning = await findDefaultReasoningConfig(this.pool, tenantId);
    const reasoningConfig = assignment?.reasoning_config
      ?? systemDefaultReasoning
      ?? null;

    const authMode = (provider.auth_mode as string) ?? 'api_key';

    const providerType = readProviderTypeOrThrow(provider.metadata, provider.name);

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
        maxOutputTokens: model.max_output_tokens,
        endpointType: model.endpoint_type,
        reasoningConfig: model.reasoning_config,
        inputCostPerMillionUsd: parseNullableCost(model.input_cost_per_million_usd),
        outputCostPerMillionUsd: parseNullableCost(model.output_cost_per_million_usd),
      },
      reasoningConfig,
      nativeSearch: readNativeSearchCapability(model.model_id),
    };
  }

  async getProviderForOperations(tenantId: string, id: string): Promise<ProviderRow> {
    const provider = await this.getStoredProvider(tenantId, id);
    return {
      ...provider,
      api_key_secret_ref: provider.api_key_secret_ref
        ? readProviderSecret(provider.api_key_secret_ref)
        : null,
    };
  }

  private async getStoredProvider(tenantId: string, id: string): Promise<ProviderRow> {
    const repo = new TenantScopedRepository(this.pool, tenantId);
    const row = await repo.findById<ProviderRow>('llm_providers', '*', id);
    if (!row) throw new NotFoundError('LLM provider not found');
    return row;
  }

}

function assertModelCanBeEnabled(input: {
  contextWindow: number | null | undefined;
  maxOutputTokens: number | null | undefined;
}): void {
  if (!hasRequiredModelLimits(input)) {
    throw new ValidationError(
      'Enabled models must define both context window and max output tokens',
    );
  }
}

function hasRequiredModelLimits(input: {
  contextWindow: number | null | undefined;
  maxOutputTokens: number | null | undefined;
}): boolean {
  return typeof input.contextWindow === 'number' && typeof input.maxOutputTokens === 'number';
}
