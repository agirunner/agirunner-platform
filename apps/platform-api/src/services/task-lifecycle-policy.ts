import { SchemaValidationFailedError, ValidationError } from '../errors/domain-errors.js';

type RecordValue = Record<string, unknown>;

export type RetryBackoffStrategy = 'fixed' | 'linear' | 'exponential';

export interface RetryPolicy {
  max_attempts: number;
  backoff_strategy: RetryBackoffStrategy;
  initial_backoff_seconds: number;
  retryable_categories: string[];
}

export interface EscalationPolicy {
  role: string;
  title_template: string;
  instructions?: string;
  enabled: boolean;
}

export interface ReworkPolicy {
  max_cycles: number;
}

export interface LifecyclePolicy {
  retry_policy?: RetryPolicy;
  escalation?: EscalationPolicy;
  rework?: ReworkPolicy;
}

const allowedStrategies = new Set<RetryBackoffStrategy>(['fixed', 'linear', 'exponential']);
const defaultRetryableCategories = ['timeout', 'transient_error', 'resource_unavailable', 'network_error'];

export function readTemplateLifecyclePolicy(value: unknown, fieldName: string): LifecyclePolicy | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new SchemaValidationFailedError(`${fieldName} must be an object`);
  }

  const retryPolicy = normalizeRetryPolicy(value.retry_policy, `${fieldName}.retry_policy`);
  const escalation = normalizeEscalationPolicy(value.escalation, `${fieldName}.escalation`);
  const rework = normalizeReworkPolicy(value.rework, `${fieldName}.rework`);
  if (!retryPolicy && !escalation && !rework) {
    return undefined;
  }
  return {
    ...(retryPolicy ? { retry_policy: retryPolicy } : {}),
    ...(escalation ? { escalation } : {}),
    ...(rework ? { rework } : {}),
  };
}

export function mergeLifecyclePolicy(
  base: LifecyclePolicy | undefined,
  override: LifecyclePolicy | undefined,
): LifecyclePolicy | undefined {
  if (!base && !override) {
    return undefined;
  }

  return {
    ...(base?.retry_policy ? { retry_policy: cloneRetryPolicy(base.retry_policy) } : {}),
    ...(base?.escalation ? { escalation: cloneEscalationPolicy(base.escalation) } : {}),
    ...(base?.rework ? { rework: cloneReworkPolicy(base.rework) } : {}),
    ...(override?.retry_policy ? { retry_policy: cloneRetryPolicy(override.retry_policy) } : {}),
    ...(override?.escalation ? { escalation: cloneEscalationPolicy(override.escalation) } : {}),
    ...(override?.rework ? { rework: cloneReworkPolicy(override.rework) } : {}),
  };
}

export function readPersistedLifecyclePolicy(metadata: unknown): LifecyclePolicy | undefined {
  if (!isRecord(metadata)) {
    return undefined;
  }
  return readTemplateLifecyclePolicy(metadata.lifecycle_policy, 'metadata.lifecycle_policy');
}

export function calculateRetryBackoffSeconds(policy: RetryPolicy, attemptNumber: number): number {
  if (policy.backoff_strategy === 'fixed') {
    return policy.initial_backoff_seconds;
  }
  if (policy.backoff_strategy === 'linear') {
    return policy.initial_backoff_seconds * attemptNumber;
  }
  return policy.initial_backoff_seconds * 2 ** (attemptNumber - 1);
}

function normalizeRetryPolicy(value: unknown, fieldName: string): RetryPolicy | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new ValidationError(`${fieldName} must be an object`);
  }

  const maxAttempts = Number(value.max_attempts);
  const initialBackoffSeconds = Number(value.initial_backoff_seconds ?? 0);
  const backoffStrategy = String(value.backoff_strategy ?? 'fixed') as RetryBackoffStrategy;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new ValidationError(`${fieldName}.max_attempts must be a positive integer`);
  }
  if (!Number.isInteger(initialBackoffSeconds) || initialBackoffSeconds < 0) {
    throw new ValidationError(`${fieldName}.initial_backoff_seconds must be a non-negative integer`);
  }
  if (!allowedStrategies.has(backoffStrategy)) {
    throw new ValidationError(`${fieldName}.backoff_strategy must be fixed, linear, or exponential`);
  }

  const retryableCategories = Array.isArray(value.retryable_categories)
    ? value.retryable_categories.map((entry) => String(entry))
    : defaultRetryableCategories;

  return {
    max_attempts: maxAttempts,
    backoff_strategy: backoffStrategy,
    initial_backoff_seconds: initialBackoffSeconds,
    retryable_categories: retryableCategories,
  };
}

function normalizeEscalationPolicy(value: unknown, fieldName: string): EscalationPolicy | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new ValidationError(`${fieldName} must be an object`);
  }

  const enabled = value.enabled !== false;
  const role = typeof value.role === 'string' && value.role.trim().length > 0
    ? value.role
    : 'orchestrator';
  const titleTemplate =
    typeof value.title_template === 'string' && value.title_template.trim().length > 0
      ? value.title_template
      : 'Escalation: {{task_title}}';
  const instructions =
    typeof value.instructions === 'string' && value.instructions.trim().length > 0
      ? value.instructions
      : undefined;

  return {
    enabled,
    role,
    title_template: titleTemplate,
    ...(instructions ? { instructions } : {}),
  };
}

function cloneRetryPolicy(policy: RetryPolicy): RetryPolicy {
  return {
    ...policy,
    retryable_categories: [...policy.retryable_categories],
  };
}

function cloneEscalationPolicy(policy: EscalationPolicy): EscalationPolicy {
  return {
    ...policy,
  };
}

function normalizeReworkPolicy(value: unknown, fieldName: string): ReworkPolicy | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new ValidationError(`${fieldName} must be an object`);
  }

  const maxCycles = Number(value.max_cycles ?? 3);
  if (!Number.isInteger(maxCycles) || maxCycles < 1) {
    throw new ValidationError(`${fieldName}.max_cycles must be a positive integer`);
  }

  return { max_cycles: maxCycles };
}

function cloneReworkPolicy(policy: ReworkPolicy): ReworkPolicy {
  return { ...policy };
}

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
