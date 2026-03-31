import type { DatabasePool } from '../../db/database.js';
import { TenantScopedRepository } from '../../db/tenant-scoped-repository.js';
import { ValidationError } from '../../errors/domain-errors.js';

export async function findDefaultModelId(
  pool: DatabasePool,
  tenantId: string,
): Promise<string | null> {
  return getRuntimeDefault(pool, tenantId, 'default_model_id');
}

export async function findDefaultReasoningConfig(
  pool: DatabasePool,
  tenantId: string,
): Promise<Record<string, unknown> | null> {
  const raw = await getRuntimeDefault(pool, tenantId, 'default_reasoning_config');
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new ValidationError('Runtime default "default_reasoning_config" must be valid JSON object');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    throw new ValidationError('Runtime default "default_reasoning_config" must be valid JSON object');
  }
}

export async function upsertRuntimeDefault(
  pool: DatabasePool,
  tenantId: string,
  key: string,
  value: string | null,
): Promise<void> {
  if (value === null) {
    await pool.query(
      'DELETE FROM runtime_defaults WHERE tenant_id = $1 AND config_key = $2',
      [tenantId, key],
    );
    return;
  }

  await pool.query(
    `INSERT INTO runtime_defaults (tenant_id, config_key, config_value, config_type)
       VALUES ($1, $2, $3, 'string')
       ON CONFLICT (tenant_id, config_key)
       DO UPDATE SET config_value = $3, updated_at = NOW()`,
    [tenantId, key, value],
  );
}

async function getRuntimeDefault(
  pool: DatabasePool,
  tenantId: string,
  key: string,
): Promise<string | null> {
  const repo = new TenantScopedRepository(pool, tenantId);
  const rows = await repo.findAll<{ config_value: string; [key: string]: unknown; tenant_id: string }>(
    'runtime_defaults',
    'config_value',
    ['config_key = $2'],
    [key],
  );
  return rows[0]?.config_value ?? null;
}
