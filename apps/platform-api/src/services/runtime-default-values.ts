import type { DatabaseClient, DatabasePool } from '../db/database.js';
import { ValidationError } from '../errors/domain-errors.js';

export const TASK_DEFAULT_TIMEOUT_MINUTES_RUNTIME_KEY = 'tasks.default_timeout_minutes';

export async function readRuntimeDefaultValue(
  db: DatabaseClient | DatabasePool,
  tenantId: string,
  key: string,
): Promise<string | null> {
  const result = await db.query<{ config_value: string }>(
    `SELECT config_value
       FROM runtime_defaults
      WHERE tenant_id = $1
        AND config_key = $2
      LIMIT 1`,
    [tenantId, key],
  );
  return result.rows[0]?.config_value ?? null;
}

export async function readRequiredPositiveIntegerRuntimeDefault(
  db: DatabaseClient | DatabasePool,
  tenantId: string,
  key: string,
): Promise<number> {
  const rawValue = await readRuntimeDefaultValue(db, tenantId, key);
  if (rawValue === null) {
    throw new ValidationError(`Missing runtime default "${key}"`);
  }

  const parsed = readPositiveInteger(rawValue);
  if (parsed === null) {
    throw new ValidationError(`Runtime default "${key}" must be a positive integer`);
  }

  return parsed;
}

export function readPositiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}
