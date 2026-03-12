import { z } from 'zod';

import { SchemaValidationFailedError } from '../errors/domain-errors.js';

const boardColumnSchema = z.object({
  id: z.string().min(1).max(120),
  label: z.string().min(1).max(120),
  description: z.string().max(4000).optional(),
  is_blocked: z.boolean().optional(),
  is_terminal: z.boolean().optional(),
});

const stageSchema = z.object({
  name: z.string().min(1).max(120),
  goal: z.string().min(1).max(4000),
  involves: z.array(z.string().min(1).max(120)).optional(),
  human_gate: z.boolean().optional(),
  guidance: z.string().max(8000).optional(),
});

const runtimePoolSchema = z.object({
  pool_mode: z.enum(['warm', 'cold']).optional(),
  max_runtimes: z.number().int().positive().optional(),
  priority: z.number().int().min(0).optional(),
  idle_timeout_seconds: z.number().int().min(0).optional(),
  grace_period_seconds: z.number().int().min(0).optional(),
  image: z.string().min(1).optional(),
  pull_policy: z.enum(['always', 'if-not-present', 'never']).optional(),
  cpu: z.string().min(1).optional(),
  memory: z.string().min(1).optional(),
});

const runtimeSchema = runtimePoolSchema.extend({
  orchestrator_pool: runtimePoolSchema.optional(),
  specialist_pool: runtimePoolSchema.optional(),
});

const playbookDefinitionSchema = z.object({
  roles: z.array(z.string().min(1).max(120)).default([]),
  board: z.object({
    columns: z.array(boardColumnSchema).min(1),
  }),
  stages: z.array(stageSchema).default([]),
  lifecycle: z.enum(['standard', 'continuous']).default('standard'),
  orchestrator: z
    .object({
      check_interval: z.string().max(120).optional(),
      stale_threshold: z.string().max(120).optional(),
      max_rework_iterations: z.number().int().min(0).optional(),
      max_active_tasks: z.number().int().positive().optional(),
      max_active_tasks_per_work_item: z.number().int().positive().optional(),
      allow_parallel_work_items: z.boolean().optional(),
    })
    .optional(),
  runtime: runtimeSchema.optional(),
  parameters: z.array(z.record(z.unknown())).optional(),
});

export type PlaybookDefinition = z.infer<typeof playbookDefinitionSchema>;
export type PlaybookRuntimeConfig = z.infer<typeof runtimeSchema>;
export type PlaybookRuntimePoolConfig = z.infer<typeof runtimePoolSchema>;
export type PlaybookRuntimePoolKind = 'orchestrator' | 'specialist';

export interface PlaybookRuntimePoolTarget {
  pool_kind: PlaybookRuntimePoolKind;
  config: PlaybookRuntimePoolConfig;
}

export function parsePlaybookDefinition(value: unknown): PlaybookDefinition {
  const parsed = playbookDefinitionSchema.safeParse(value);
  if (!parsed.success) {
    throw new SchemaValidationFailedError('Invalid playbook definition', {
      issues: parsed.error.flatten(),
    });
  }

  assertUniqueIds(parsed.data.board.columns.map((column) => column.id), 'board column');
  assertUniqueIds(parsed.data.stages.map((stage) => stage.name), 'stage');
  return parsed.data;
}

export function defaultColumnId(definition: PlaybookDefinition): string {
  return definition.board.columns[0].id;
}

export function defaultStageName(definition: PlaybookDefinition): string | null {
  return definition.stages[0]?.name ?? null;
}

export function hasBoardColumn(definition: PlaybookDefinition, columnId: string): boolean {
  return definition.board.columns.some((column) => column.id === columnId);
}

export function hasStage(definition: PlaybookDefinition, stageName: string): boolean {
  if (definition.stages.length === 0) {
    return true;
  }
  return definition.stages.some((stage) => stage.name === stageName);
}

export function readPlaybookRuntime(definition: PlaybookDefinition): PlaybookRuntimeConfig | null {
  return definition.runtime ?? null;
}

export function readPlaybookRuntimePools(definition: PlaybookDefinition): PlaybookRuntimePoolTarget[] {
  const runtime = definition.runtime;
  if (!runtime) {
    return [];
  }

  const shared = readSharedRuntimeConfig(runtime);
  const explicitPoolConfigs = [
    runtime.orchestrator_pool
      ? {
          pool_kind: 'orchestrator' as const,
          config: mergeRuntimeConfig(shared, runtime.orchestrator_pool),
        }
      : null,
    runtime.specialist_pool
      ? {
          pool_kind: 'specialist' as const,
          config: mergeRuntimeConfig(shared, runtime.specialist_pool),
        }
      : null,
  ].filter((entry): entry is PlaybookRuntimePoolTarget => entry !== null);

  if (explicitPoolConfigs.length > 0) {
    return explicitPoolConfigs;
  }

  return [{ pool_kind: 'specialist', config: shared }];
}

function assertUniqueIds(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new SchemaValidationFailedError(`Duplicate ${label} '${value}' in playbook definition`);
    }
    seen.add(value);
  }
}

function readSharedRuntimeConfig(runtime: PlaybookRuntimeConfig): PlaybookRuntimePoolConfig {
  return {
    pool_mode: runtime.pool_mode,
    max_runtimes: runtime.max_runtimes,
    priority: runtime.priority,
    idle_timeout_seconds: runtime.idle_timeout_seconds,
    grace_period_seconds: runtime.grace_period_seconds,
    image: runtime.image,
    pull_policy: runtime.pull_policy,
    cpu: runtime.cpu,
    memory: runtime.memory,
  };
}

function mergeRuntimeConfig(
  base: PlaybookRuntimePoolConfig,
  override: PlaybookRuntimePoolConfig,
): PlaybookRuntimePoolConfig {
  return {
    ...base,
    ...override,
  };
}
