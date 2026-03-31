import type { DatabaseQueryable } from '../db/database.js';
import { ValidationError } from '../errors/domain-errors.js';
import type { ExecutionEnvironmentPullPolicy } from './execution-environment/contract.js';

export const TASK_DEFAULT_TIMEOUT_MINUTES_RUNTIME_KEY = 'tasks.default_timeout_minutes';
export const TASK_MAX_ITERATIONS_RUNTIME_KEY = 'agent.max_iterations';
export const TASK_LLM_MAX_RETRIES_RUNTIME_KEY = 'agent.llm_max_retries';
export const GLOBAL_MAX_SPECIALISTS_RUNTIME_KEY = 'global_max_specialists';

export const SPECIALIST_RUNTIME_DEFAULT_KEYS = {
  image: 'specialist_runtime_default_image',
  cpu: 'specialist_runtime_default_cpu',
  memory: 'specialist_runtime_default_memory',
  pullPolicy: 'specialist_runtime_default_pull_policy',
  bootstrapClaimTimeoutSeconds: 'specialist_runtime_bootstrap_claim_timeout_seconds',
  drainGraceSeconds: 'specialist_runtime_drain_grace_seconds',
} as const;

export interface SpecialistRuntimeDefaults {
  image: string;
  cpu: string;
  memory: string;
  pull_policy: ExecutionEnvironmentPullPolicy;
  bootstrap_claim_timeout_seconds: number;
  drain_grace_seconds: number;
}

export async function readRuntimeDefaultValue(
  db: DatabaseQueryable,
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
  db: DatabaseQueryable,
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

export async function readRequiredStringRuntimeDefault(
  db: DatabaseQueryable,
  tenantId: string,
  key: string,
): Promise<string> {
  const rawValue = await readRuntimeDefaultValue(db, tenantId, key);
  if (rawValue === null || rawValue.trim().length === 0) {
    throw new ValidationError(`Missing runtime default "${key}"`);
  }
  return rawValue.trim();
}

export async function readSpecialistRuntimeDefaults(
  db: DatabaseQueryable,
  tenantId: string,
): Promise<SpecialistRuntimeDefaults> {
  return {
    image: await readRequiredStringRuntimeDefault(
      db,
      tenantId,
      SPECIALIST_RUNTIME_DEFAULT_KEYS.image,
    ),
    cpu: await readRequiredStringRuntimeDefault(
      db,
      tenantId,
      SPECIALIST_RUNTIME_DEFAULT_KEYS.cpu,
    ),
    memory: await readRequiredStringRuntimeDefault(
      db,
      tenantId,
      SPECIALIST_RUNTIME_DEFAULT_KEYS.memory,
    ),
    pull_policy: await readRequiredPullPolicyRuntimeDefault(
      db,
      tenantId,
      SPECIALIST_RUNTIME_DEFAULT_KEYS.pullPolicy,
    ),
    bootstrap_claim_timeout_seconds: await readRequiredPositiveIntegerRuntimeDefault(
      db,
      tenantId,
      SPECIALIST_RUNTIME_DEFAULT_KEYS.bootstrapClaimTimeoutSeconds,
    ),
    drain_grace_seconds: await readRequiredPositiveIntegerRuntimeDefault(
      db,
      tenantId,
      SPECIALIST_RUNTIME_DEFAULT_KEYS.drainGraceSeconds,
    ),
  };
}

async function readRequiredPullPolicyRuntimeDefault(
  db: DatabaseQueryable,
  tenantId: string,
  key: string,
): Promise<ExecutionEnvironmentPullPolicy> {
  const value = await readRequiredStringRuntimeDefault(db, tenantId, key);
  switch (value) {
  case 'always':
  case 'if-not-present':
  case 'never':
    return value;
  default:
    throw new ValidationError(
      `Runtime default "${key}" must be one of: always, if-not-present, never`,
    );
  }
}

export function readPositiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}
