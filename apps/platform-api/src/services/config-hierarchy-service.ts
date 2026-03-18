import { z } from 'zod';

import { ValidationError } from '../errors/domain-errors.js';
import { normalizeSuppressedLayers, type InstructionLayerName } from './instruction-policy.js';

type RecordValue = Record<string, unknown>;

const modelOverrideSchema = z
  .object({
    model_id: z.string().uuid().nullable().optional(),
    reasoning_config: z.record(z.unknown()).nullable().optional(),
  })
  .strict()
  .refine(
    (value) => value.model_id !== undefined || value.reasoning_config !== undefined,
    'model_override must include model_id or reasoning_config',
  );

interface ConfigConstraint {
  enum?: unknown[];
  min?: number;
  max?: number;
}

interface ConfigPolicy {
  locked: string[];
  constraints: Record<string, ConfigConstraint>;
}

export interface ResolvedWorkflowConfig {
  resolved: RecordValue;
  layers: {
    playbook: RecordValue;
    workspace: RecordValue;
    run: RecordValue;
  };
}

export interface InstructionConfig {
  suppress_layers: InstructionLayerName[];
}

export interface ModelOverride {
  model_id?: string | null;
  reasoning_config?: Record<string, unknown> | null;
}

export interface EffectiveModelOverride {
  model_id: string | null;
  reasoning_config: Record<string, unknown> | null;
}

export function resolveWorkflowConfig(
  playbookSchema: RecordValue,
  workspaceSpec: RecordValue,
  runOverrides: RecordValue,
): ResolvedWorkflowConfig {
  const playbookConfig = asRecord(playbookSchema.config);
  const workspaceConfig = readWorkflowConfigLayer(workspaceSpec);
  const runConfig = readWorkflowConfigLayer(runOverrides);
  const policy = readConfigPolicy(playbookSchema);

  validateOverrides('workspace config', workspaceConfig, policy);
  validateOverrides('workflow config override', runConfig, policy);

  return {
    resolved: mergeRecords(mergeRecords(playbookConfig, workspaceConfig), runConfig),
    layers: {
      playbook: cloneRecord(playbookConfig),
      workspace: cloneRecord(workspaceConfig),
      run: cloneRecord(runConfig),
    },
  };
}

export function resolveInstructionConfig(
  playbookSchema: RecordValue,
  override: unknown,
): InstructionConfig {
  const defaults = readInstructionConfig(playbookSchema.default_instruction_config);
  if (override === undefined) {
    return defaults;
  }
  return readInstructionConfig(override);
}

export function buildResolvedConfigView(
  resolved: RecordValue,
  layers: ResolvedWorkflowConfig['layers'],
  showLayers: boolean,
): RecordValue {
  if (!showLayers) {
    return resolved;
  }
  return annotateSources(resolved, layers, []);
}

export function readModelOverride(value: unknown, label = 'model_override'): ModelOverride | null {
  if (value === undefined || value === null) {
    return null;
  }
  const result = modelOverrideSchema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(`Invalid ${label}`, { issues: result.error.flatten() });
  }
  return {
    ...(result.data.model_id !== undefined ? { model_id: result.data.model_id } : {}),
    ...(result.data.reasoning_config !== undefined
      ? { reasoning_config: result.data.reasoning_config ?? null }
      : {}),
  };
}

export function readWorkflowConfigLayer(value: unknown): RecordValue {
  const record = asRecord(value);
  const config = mergeRecords(
    cloneRecord(asRecord(record.config)),
    cloneRecord(stripReservedKeys(record)),
  );
  const modelOverride = readModelOverride(record.model_override, 'model_override');
  if (modelOverride) {
    config.model_override = modelOverride;
  }
  return config;
}

export function overlayModelOverride(
  base: EffectiveModelOverride,
  override: ModelOverride | null,
): EffectiveModelOverride {
  if (!override) {
    return base;
  }

  return {
    model_id: override.model_id !== undefined ? override.model_id : base.model_id,
    reasoning_config:
      override.reasoning_config !== undefined ? override.reasoning_config : base.reasoning_config,
  };
}

function readConfigPolicy(playbookSchema: RecordValue): ConfigPolicy {
  const policy = asRecord(playbookSchema.config_policy);
  const locked = Array.isArray(policy.locked)
    ? policy.locked.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
  const constraints = asRecord(policy.constraints);
  const normalizedConstraints: Record<string, ConfigConstraint> = {};

  for (const [path, rawConstraint] of Object.entries(constraints)) {
    const constraint = asRecord(rawConstraint);
    normalizedConstraints[path] = {
      enum: Array.isArray(constraint.enum) ? constraint.enum : undefined,
      min: typeof constraint.min === 'number' ? constraint.min : undefined,
      max: typeof constraint.max === 'number' ? constraint.max : undefined,
    };
  }

  return { locked, constraints: normalizedConstraints };
}

function validateOverrides(label: string, override: RecordValue, policy: ConfigPolicy): void {
  for (const path of collectPaths(override)) {
    if (policy.locked.includes(path)) {
      throw new ValidationError(`${label} cannot override locked field '${path}'`);
    }
    const value = getValueAtPath(override, path);
    const constraint = policy.constraints[path];
    if (constraint) {
      validateConstraint(path, value, constraint);
    }
  }
}

function validateConstraint(path: string, value: unknown, constraint: ConfigConstraint): void {
  if (constraint.enum && !constraint.enum.some((candidate) => candidate === value)) {
    throw new ValidationError(`Config field '${path}' must be one of the allowed values`);
  }
  if (typeof value === 'number') {
    if (typeof constraint.min === 'number' && value < constraint.min) {
      throw new ValidationError(`Config field '${path}' must be >= ${constraint.min}`);
    }
    if (typeof constraint.max === 'number' && value > constraint.max) {
      throw new ValidationError(`Config field '${path}' must be <= ${constraint.max}`);
    }
  }
}

function annotateSources(
  resolved: RecordValue,
  layers: ResolvedWorkflowConfig['layers'],
  prefix: string[],
): RecordValue {
  const annotated: RecordValue = {};
  for (const [key, value] of Object.entries(resolved)) {
    const path = [...prefix, key];
    if (isRecord(value)) {
      annotated[key] = annotateSources(value, layers, path);
      continue;
    }
    annotated[key] = {
      value,
      source: resolveSource(path, layers),
    };
  }
  return annotated;
}

function resolveSource(
  path: string[],
  layers: ResolvedWorkflowConfig['layers'],
): 'playbook' | 'workspace' | 'run' {
  if (hasValueAtPath(layers.run, path)) {
    return 'run';
  }
  if (hasValueAtPath(layers.workspace, path)) {
    return 'workspace';
  }
  return 'playbook';
}

function readInstructionConfig(value: unknown): InstructionConfig {
  if (value === undefined || value === null) {
    return { suppress_layers: [] };
  }
  if (!isRecord(value)) {
    throw new ValidationError('instruction_config must be an object');
  }
  return {
    suppress_layers: normalizeSuppressedLayers(value.suppress_layers),
  };
}

function collectPaths(record: RecordValue, prefix = ''): string[] {
  const paths: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    const path = prefix.length > 0 ? `${prefix}.${key}` : key;
    if (isRecord(value)) {
      paths.push(...collectPaths(value, path));
      continue;
    }
    paths.push(path);
  }
  return paths;
}

function getValueAtPath(record: RecordValue, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!isRecord(current)) {
      return undefined;
    }
    return current[segment];
  }, record);
}

function hasValueAtPath(record: RecordValue, path: string[]): boolean {
  let current: unknown = record;
  for (const segment of path) {
    if (!isRecord(current) || !(segment in current)) {
      return false;
    }
    current = current[segment];
  }
  return true;
}

function mergeRecords(base: RecordValue, override: RecordValue): RecordValue {
  const merged = cloneRecord(base);
  for (const [key, value] of Object.entries(override)) {
    if (isRecord(value) && isRecord(merged[key])) {
      merged[key] = mergeRecords(merged[key] as RecordValue, value);
      continue;
    }
    merged[key] = cloneValue(value);
  }
  return merged;
}

function cloneRecord(value: RecordValue): RecordValue {
  const clone: RecordValue = {};
  for (const [key, entry] of Object.entries(value)) {
    clone[key] = cloneValue(entry);
  }
  return clone;
}

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneValue(entry));
  }
  if (isRecord(value)) {
    return cloneRecord(value);
  }
  return value;
}

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asRecord(value: unknown): RecordValue {
  return isRecord(value) ? value : {};
}

function stripReservedKeys(record: RecordValue): RecordValue {
  const { config: _config, model_override: _modelOverride, ...rest } = record;
  return rest;
}
