import { z } from 'zod';

import { ValidationError } from '../../errors/domain-errors.js';
import { assertValidContainerCpu, assertValidContainerImage, assertValidContainerMemory } from '../container-resource-validation.js';

const DEFAULT_SPECIALIST_CPU_LIMIT = '2';
const DEFAULT_SPECIALIST_MEMORY_LIMIT = '256m';
const DEFAULT_ORCHESTRATOR_CPU_LIMIT = '2';
const DEFAULT_ORCHESTRATOR_MEMORY_LIMIT = '256m';
const FLEET_ENV_SECRET_REDACTION = 'redacted://fleet-environment-secret';
const FLEET_WORKER_NOT_FOUND_MESSAGE = 'Fleet worker not found';
const secretLikeKeyPattern = /(secret|token|password|api[_-]?key|credential|authorization|private[_-]?key|known_hosts)/i;
const secretLikeValuePattern =
  /(?:^enc:v\d+:|^secret:|^redacted:\/\/|^Bearer\s+\S+|^sk-[A-Za-z0-9_-]+|^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/i;

export const createDesiredStateSchema = z.object({
  workerName: z.string().min(1).max(200),
  role: z.string().min(1).max(100),
  poolKind: z.enum(['orchestrator', 'specialist']).default('specialist'),
  runtimeImage: z.string().min(1),
  cpuLimit: z.string().optional(),
  memoryLimit: z.string().optional(),
  networkPolicy: z.string().default('restricted'),
  environment: z.record(z.unknown()).default({}),
  llmProvider: z.string().optional(),
  llmModel: z.string().optional(),
  llmApiKeySecretRef: z.string().optional(),
  replicas: z.number().int().positive().default(1),
  enabled: z.boolean().default(true),
});

export const updateDesiredStateSchema = createDesiredStateSchema.partial().omit({ workerName: true });

export type CreateDesiredStateInput = z.infer<typeof createDesiredStateSchema>;
export type UpdateDesiredStateInput = z.infer<typeof updateDesiredStateSchema>;

interface DesiredStateRow {
  [key: string]: unknown;
  id: string;
  tenant_id: string;
  worker_name: string;
  role: string;
  pool_kind: string;
  runtime_image: string;
  cpu_limit: string;
  memory_limit: string;
  network_policy: string;
  environment: Record<string, unknown>;
  llm_provider: string | null;
  llm_model: string | null;
  llm_api_key_secret_ref: string | null;
  replicas: number;
  enabled: boolean;
  restart_requested: boolean;
  draining: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
  updated_by: string | null;
  active_task_id?: string | null;
}

export interface PublicDesiredStateRow extends Omit<DesiredStateRow, 'environment' | 'llm_api_key_secret_ref'> {
  environment: Record<string, unknown>;
  llm_api_key_secret_ref_configured: boolean;
}

export interface ActualStateRow {
  id: string;
  desired_state_id: string;
  container_id: string | null;
  container_status: string | null;
  cpu_usage_percent: number | null;
  memory_usage_bytes: number | null;
  network_rx_bytes: number | null;
  network_tx_bytes: number | null;
  started_at: Date | null;
  last_updated: Date;
}

export interface ContainerView {
  [key: string]: unknown;
  id: string;
  container_id: string | null;
  name: string;
  status: string;
  image: string;
  worker_role: string;
  pool_kind: string;
  cpu_usage_percent: number | null;
  memory_usage_bytes: number | null;
  started_at: Date | null;
  last_updated: Date;
}

export interface ContainerImageRow {
  id: string;
  repository: string;
  tag: string | null;
  digest: string | null;
  size_bytes: number | null;
  created_at: Date | null;
  last_seen: Date;
}

export interface FleetWorkerView extends PublicDesiredStateRow {
  actual: ActualStateRow[];
}

export const ACTIVE_WORKER_TASK_STATES = ['claimed', 'in_progress'] as const;
export const HUNG_RUNTIME_STALE_AFTER_SECONDS_KEY = 'container_manager.hung_runtime_stale_after_seconds';

function resolveCreateDesiredStateDefaults(input: CreateDesiredStateInput): CreateDesiredStateInput & {
  cpuLimit: string;
  memoryLimit: string;
} {
  const defaults =
    input.poolKind === 'orchestrator'
      ? {
          cpuLimit: DEFAULT_ORCHESTRATOR_CPU_LIMIT,
          memoryLimit: DEFAULT_ORCHESTRATOR_MEMORY_LIMIT,
        }
      : {
          cpuLimit: DEFAULT_SPECIALIST_CPU_LIMIT,
          memoryLimit: DEFAULT_SPECIALIST_MEMORY_LIMIT,
        };

  return {
    ...input,
    cpuLimit: input.cpuLimit ?? defaults.cpuLimit,
    memoryLimit: input.memoryLimit ?? defaults.memoryLimit,
  };
}

export function toPublicDesiredStateRow(row: DesiredStateRow): PublicDesiredStateRow {
  const { llm_api_key_secret_ref: llmApiKeySecretRef, ...rest } = row;
  return {
    ...rest,
    environment: redactEnvironmentSecrets(row.environment),
    llm_api_key_secret_ref_configured:
      typeof llmApiKeySecretRef === 'string' && llmApiKeySecretRef.trim().length > 0,
  };
}

export function resolveWorkerCreateDefaults(input: CreateDesiredStateInput): CreateDesiredStateInput & {
  cpuLimit: string;
  memoryLimit: string;
} {
  return resolveCreateDesiredStateDefaults(input);
}

export function validateDesiredStateSecrets(input: {
  environment?: Record<string, unknown>;
  llmApiKeySecretRef?: string;
}): void {
  validateEnvironmentSecrets(input.environment ?? {}, []);
  validateLlmSecretRef(input.llmApiKeySecretRef);
}

export function validateDesiredStateResources(input: {
  runtimeImage?: string;
  cpuLimit?: string;
  memoryLimit?: string;
}): void {
  if (typeof input.runtimeImage === 'string') {
    assertValidContainerImage(input.runtimeImage, 'Specialist Agent image');
  }
  if (typeof input.cpuLimit === 'string') {
    assertValidContainerCpu(input.cpuLimit, 'CPU limit');
  }
  if (typeof input.memoryLimit === 'string') {
    assertValidContainerMemory(input.memoryLimit, 'Memory limit');
  }
}

export function redactEnvironmentSecrets(
  environment: Record<string, unknown>,
  inheritedSecret = false,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(environment).map(([key, value]) => {
      const branchIsSecret = inheritedSecret || isSecretLikeKey(key);
      return [key, redactEnvironmentValue(value, branchIsSecret)];
    }),
  );
}

function redactEnvironmentValue(value: unknown, inheritedSecret: boolean): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactEnvironmentValue(entry, inheritedSecret));
  }

  if (value && typeof value === 'object') {
    return redactEnvironmentSecrets(value as Record<string, unknown>, inheritedSecret);
  }

  if (typeof value !== 'string') {
    return value;
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    return value;
  }

  if (inheritedSecret || isSecretReference(normalized) || isSecretLikeValue(normalized)) {
    return FLEET_ENV_SECRET_REDACTION;
  }

  return value;
}

function isSecretReference(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith('secret:') || normalized.startsWith('redacted://');
}

function isSecretLikeKey(key: string): boolean {
  return secretLikeKeyPattern.test(key);
}

function isSecretLikeValue(value: string): boolean {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return false;
  }
  return secretLikeValuePattern.test(normalized);
}

function validateEnvironmentSecrets(environment: Record<string, unknown>, path: string[]): void {
  for (const [key, value] of Object.entries(environment)) {
    validateEnvironmentValue(key, value, [...path, key], isSecretLikeKey(key));
  }
}

function validateEnvironmentValue(
  key: string,
  value: unknown,
  path: string[],
  inheritedSecret: boolean,
): void {
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      validateEnvironmentValue(key, entry, [...path, String(index)], inheritedSecret);
    }
    return;
  }

  if (value && typeof value === 'object') {
    for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      validateEnvironmentValue(
        nestedKey,
        nestedValue,
        [...path, nestedKey],
        inheritedSecret || isSecretLikeKey(nestedKey),
      );
    }
    return;
  }

  if (typeof value !== 'string') {
    return;
  }

  const normalized = value.trim();
  if (normalized.length === 0 || isSecretReference(normalized)) {
    return;
  }

  if (inheritedSecret || isSecretLikeValue(normalized)) {
    throw new ValidationError(
      `Environment field ${path.join('.')} must use secret: references instead of plaintext secret values`,
    );
  }
}

function validateLlmSecretRef(value: string | undefined): void {
  if (value === undefined) {
    return;
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    return;
  }
  if (!normalized.toLowerCase().startsWith('secret:')) {
    throw new ValidationError('llmApiKeySecretRef must use secret: references');
  }
}

