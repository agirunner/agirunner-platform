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
  guidance: z.string().max(8000).optional(),
});

const parameterSchema = z
  .object({
    slug: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9][a-z0-9_-]*$/, 'Parameter slug must use lowercase letters, numbers, underscores, or hyphens'),
    title: z.string().min(1).max(255),
    required: z.boolean().optional().default(false),
  })
  .strict();

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
  outcome: z.string().max(4000).optional(),
  process_instructions: z.string().min(1).max(12000).optional(),
  roles: z.array(z.string().min(1).max(120)).default([]),
  board: z.object({
    entry_column_id: z.string().min(1).max(120).optional(),
    columns: z.array(boardColumnSchema).min(1),
  }),
  stages: z.array(stageSchema).default([]),
  lifecycle: z.enum(['planned', 'ongoing']).default('planned'),
  orchestrator: z
    .object({
      instructions: z.string().max(20000).optional(),
      tools: z.array(z.string().min(1).max(120)).max(64).optional(),
      max_rework_iterations: z.number().int().min(0).optional(),
      max_iterations: z.number().int().min(1).optional(),
      llm_max_retries: z.number().int().min(1).optional(),
      max_active_tasks: z.number().int().positive().optional(),
      max_active_tasks_per_work_item: z.number().int().positive().optional(),
      allow_parallel_work_items: z.boolean().optional(),
    })
    .optional(),
  config: z.record(z.unknown()).optional(),
  config_policy: z.record(z.unknown()).optional(),
  default_instruction_config: z.record(z.unknown()).optional(),
  runtime: runtimeSchema.optional(),
  parameters: z.array(parameterSchema).optional(),
}).strict();

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

  const normalized = normalizePlaybookDefinition(parsed.data);

  assertUniqueIds(normalized.board.columns.map((column) => column.id), 'board column');
  assertBoardEntryColumn(normalized);
  assertUniqueIds(normalized.stages.map((stage) => stage.name), 'stage');
  assertUniqueIds(normalized.parameters?.map((parameter) => parameter.slug) ?? [], 'launch input');
  return normalized;
}

export function defaultColumnId(definition: PlaybookDefinition): string {
  return definition.board.entry_column_id ?? definition.board.columns[0].id;
}

export function defaultStageName(definition: PlaybookDefinition): string | null {
  return definition.stages[0]?.name ?? null;
}

export function blockedColumnId(definition: PlaybookDefinition): string | null {
  return definition.board.columns.find((column) => column.is_blocked)?.id ?? null;
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

function assertBoardEntryColumn(definition: PlaybookDefinition): void {
  const entryColumnId = definition.board.entry_column_id;
  if (!entryColumnId) {
    return;
  }
  const exists = definition.board.columns.some((column) => column.id === entryColumnId);
  if (!exists) {
    throw new SchemaValidationFailedError(
      `Unknown board entry column '${entryColumnId}' in playbook definition`,
    );
  }
}

function normalizePlaybookDefinition(definition: PlaybookDefinition): PlaybookDefinition {
  const stages = definition.stages;

  return {
    ...definition,
    process_instructions:
      definition.process_instructions?.trim() ||
      definition.orchestrator?.instructions?.trim() ||
      buildLegacyProcessInstructions(stages),
    stages,
  };
}

function buildLegacyProcessInstructions(stages: PlaybookDefinition['stages']): string {
  if (stages.length === 0) {
    return 'Move work forward through the defined board lanes and deliver the requested outcome with clear handoffs and evidence.';
  }

  return stages
    .map((stage, index) => {
      const ordinal = index + 1;
      return `${ordinal}. ${stage.name}: ${stage.goal}`;
    })
    .join('\n');
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
