import { z } from 'zod';

import type { DatabaseQueryable } from '../db/database.js';
import { TenantScopedRepository } from '../db/tenant-scoped-repository.js';
import { ConflictError, NotFoundError } from '../errors/domain-errors.js';

const CONFIG_TYPES = ['string', 'number', 'boolean', 'json'] as const;
const RUNTIME_DEFAULT_SECRET_REDACTION = 'redacted://runtime-default-secret';
const runtimeDefaultSecretKeyPattern =
  /(secret|token|password|api[_-]?key|credential|authorization|private[_-]?key|webhook_url|known_hosts)/i;
const INTEGER_DEFAULT_RULES = new Map([
  ['default_grace_period', { min: 1 }],
  ['global_max_runtimes', { min: 1 }],
  ['agent.history_max_messages', { min: 1 }],
  ['agent.history_preserve_recent', { min: 1 }],
  ['agent.context_compaction_chars_per_token', { min: 1 }],
  ['agent.orchestrator_history_preserve_recent', { min: 0 }],
  ['agent.loop_detection_repeat', { min: 1 }],
  ['agent.response_repeat_threshold', { min: 1 }],
  ['agent.no_file_change_threshold', { min: 1 }],
  ['agent.max_stuck_interventions', { min: 0 }],
  ['agent.max_iterations', { min: 1 }],
  ['agent.llm_max_retries', { min: 0 }],
]);
const DECIMAL_DEFAULT_RULES = new Map([
  ['agent.context_compaction_threshold', { min: 0, max: 1 }],
  ['agent.orchestrator_context_compaction_threshold', { min: 0, max: 1 }],
]);

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
  constructor(private readonly pool: DatabaseQueryable) {}

  async listDefaults(tenantId: string): Promise<RuntimeDefaultRow[]> {
    const repo = new TenantScopedRepository(this.pool, tenantId);
    const rows = await repo.findAll<RuntimeDefaultRow>('runtime_defaults', '*');
    return rows.map(toPublicRuntimeDefaultRow);
  }

  async getDefault(tenantId: string, id: string): Promise<RuntimeDefaultRow> {
    const repo = new TenantScopedRepository(this.pool, tenantId);
    const row = await repo.findById<RuntimeDefaultRow>('runtime_defaults', '*', id);
    if (!row) throw new NotFoundError('Runtime default not found');
    return toPublicRuntimeDefaultRow(row);
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
    validateKnownRuntimeDefault(validated);

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
    return toPublicRuntimeDefaultRow(result.rows[0]);
  }

  async updateDefault(tenantId: string, id: string, input: UpdateRuntimeDefaultInput): Promise<RuntimeDefaultRow> {
    const validated = updateDefaultSchema.parse(input);
    const current = await this.getDefault(tenantId, id);
    validateKnownRuntimeDefault({
      configKey: current.config_key,
      configValue: validated.configValue ?? current.config_value,
      configType: (validated.configType ?? current.config_type) as CreateRuntimeDefaultInput['configType'],
      description: validated.description ?? current.description ?? undefined,
    });
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

    if (setClauses.length === 0) return toPublicRuntimeDefaultRow(current);

    setClauses.push('updated_at = NOW()');

    const result = await this.pool.query<RuntimeDefaultRow>(
      `UPDATE runtime_defaults SET ${setClauses.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      values,
    );
    if (!result.rowCount) throw new NotFoundError('Runtime default not found');
    return toPublicRuntimeDefaultRow(result.rows[0]);
  }

  async upsertDefault(tenantId: string, input: CreateRuntimeDefaultInput): Promise<RuntimeDefaultRow> {
    const validated = createDefaultSchema.parse(input);
    validateKnownRuntimeDefault(validated);

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
    return toPublicRuntimeDefaultRow(result.rows[0]);
  }

  async deleteDefault(tenantId: string, id: string): Promise<void> {
    const result = await this.pool.query(
      'DELETE FROM runtime_defaults WHERE tenant_id = $1 AND id = $2',
      [tenantId, id],
    );
    if (!result.rowCount) throw new NotFoundError('Runtime default not found');
  }
}

function toPublicRuntimeDefaultRow(row: RuntimeDefaultRow): RuntimeDefaultRow {
  if (!shouldRedactRuntimeDefault(row.config_key, row.config_value)) {
    return row;
  }

  return {
    ...row,
    config_value: RUNTIME_DEFAULT_SECRET_REDACTION,
  };
}

function shouldRedactRuntimeDefault(configKey: string, configValue: string): boolean {
  return runtimeDefaultSecretKeyPattern.test(configKey) && configValue.trim().length > 0;
}

function validateKnownRuntimeDefault(input: CreateRuntimeDefaultInput): void {
  validateNumericRuntimeDefault(input);

  // No tool-specific validation needed after web_search removal.
  void input;
}

function validateNumericRuntimeDefault(input: CreateRuntimeDefaultInput): void {
  const integerRule = INTEGER_DEFAULT_RULES.get(input.configKey);
  if (integerRule) {
    if (input.configType !== 'number') {
      throw new Error(`${input.configKey} must use number config type`);
    }
    const parsed = Number(input.configValue);
    if (!Number.isInteger(parsed)) {
      throw new Error(`${input.configKey} must be a whole number`);
    }
    if (parsed < integerRule.min) {
      throw new Error(`${input.configKey} must be at least ${integerRule.min}`);
    }
    return;
  }

  const decimalRule = DECIMAL_DEFAULT_RULES.get(input.configKey);
  if (!decimalRule) {
    return;
  }
  if (input.configType !== 'number') {
    throw new Error(`${input.configKey} must use number config type`);
  }
  const parsed = Number(input.configValue);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${input.configKey} must be a number`);
  }
  if (parsed < decimalRule.min || parsed > decimalRule.max) {
    throw new Error(
      `${input.configKey} must be between ${decimalRule.min} and ${decimalRule.max}`,
    );
  }
}
