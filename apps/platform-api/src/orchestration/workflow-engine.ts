import {
  ConflictError,
  CycleDetectedError,
  SchemaValidationFailedError,
} from '../errors/domain-errors.js';
import {
  applySequentialPhaseDependencies,
  type WorkflowDefinition,
  validateWorkflowDefinition,
} from './workflow-model.js';
import { readTemplateLifecyclePolicy, type LifecyclePolicy } from '../services/task-lifecycle-policy.js';
import { parseTemplateVariables, type TemplateVariableDefinition } from './template-variables.js';

export type WorkflowState = 'pending' | 'active' | 'completed' | 'failed' | 'cancelled' | 'paused';
export type OutputStorageMode = 'inline' | 'artifact' | 'git';

export interface OutputStateDeclaration {
  mode: OutputStorageMode;
  path?: string;
  media_type?: string;
  summary?: string;
}

export interface TemplateTaskDefinition {
  id: string;
  title_template: string;
  type: 'analysis' | 'code' | 'review' | 'test' | 'docs' | 'orchestration' | 'custom';
  role?: string;
  depends_on?: string[];
  blocked_by?: string[];
  requires_approval?: boolean;
  input_template?: Record<string, unknown>;
  context_template?: Record<string, unknown>;
  capabilities_required?: string[];
  role_config?: Record<string, unknown>;
  environment?: Record<string, unknown>;
  lifecycle?: LifecyclePolicy;
  output_state?: Record<string, OutputStateDeclaration>;
  timeout_minutes?: number;
  auto_retry?: boolean;
  max_retries?: number;
  metadata?: Record<string, unknown>;
}

export interface RuntimeConfig {
  pool_mode?: 'warm' | 'cold';
  max_runtimes?: number;
  priority?: number;
  idle_timeout_seconds?: number;
  grace_period_seconds?: number;
  image?: string;
  pull_policy?: 'always' | 'if-not-present' | 'never';
  cpu?: string;
  memory?: string;
}

export interface TaskContainerConfig {
  pool_mode?: 'warm' | 'cold';
  warm_pool_size?: number;
  image?: string;
  pull_policy?: 'always' | 'if-not-present' | 'never';
  cpu?: string;
  memory?: string;
}

export interface TemplateSchema {
  variables?: TemplateVariableDefinition[];
  tasks: TemplateTaskDefinition[];
  workflow?: WorkflowDefinition;
  runtime?: RuntimeConfig;
  task_container?: TaskContainerConfig;
  config?: Record<string, unknown>;
  config_policy?: Record<string, unknown>;
  default_instruction_config?: Record<string, unknown>;
  lifecycle?: LifecyclePolicy;
  /**
   * Workflow patterns map (reserved for v1.1).  Present here so the
   * no-nesting constraint (FR-712) can be validated at creation time even
   * before pattern expansion is enabled.
   */
  patterns?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/**
 * FR-712 — No pattern nesting constraint.
 *
 * Validates that no pattern definition within the `patterns` map references
 * another pattern by name.  Workflow templates must remain flat: nested
 * template references are rejected at creation time so the graph always has
 * bounded, statically-analysable depth.
 *
 * A pattern is considered to nest another pattern when its definition object
 * contains a `pattern_ref` field or when its `tasks` array contains a task
 * with `type = "pattern"`.
 */
export function assertNoPatternNesting(patterns: Record<string, unknown>): void {
  for (const [name, definition] of Object.entries(patterns)) {
    if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
      continue;
    }

    const patternDef = definition as Record<string, unknown>;

    // Direct reference to another pattern via `pattern_ref` field.
    if ('pattern_ref' in patternDef) {
      throw new SchemaValidationFailedError(
        `Pattern '${name}' contains a nested pattern reference via 'pattern_ref'. ` +
          'Pattern nesting is not allowed (FR-712).',
      );
    }

    // Tasks within the pattern that themselves reference another pattern.
    if (Array.isArray(patternDef.tasks)) {
      for (const task of patternDef.tasks as unknown[]) {
        if (!task || typeof task !== 'object' || Array.isArray(task)) {
          continue;
        }
        const taskDef = task as Record<string, unknown>;
        if (taskDef.type === 'pattern' || 'pattern_ref' in taskDef) {
          throw new SchemaValidationFailedError(
            `Pattern '${name}' contains a nested pattern task. ` +
              'Pattern nesting is not allowed (FR-712).',
          );
        }
      }
    }
  }
}

const allowedPoolModes = new Set(['warm', 'cold']);
const allowedPullPolicies = new Set(['always', 'if-not-present', 'never']);

function validateRuntimeConfig(raw: unknown): RuntimeConfig | undefined {
  if (raw === undefined) return undefined;
  if (!isObject(raw)) {
    throw new SchemaValidationFailedError("Template field 'runtime' must be an object");
  }

  const config: RuntimeConfig = {};

  if (raw.pool_mode !== undefined) {
    if (typeof raw.pool_mode !== 'string' || !allowedPoolModes.has(raw.pool_mode)) {
      throw new SchemaValidationFailedError(
        `runtime.pool_mode must be 'warm' or 'cold', got '${String(raw.pool_mode)}'`,
      );
    }
    config.pool_mode = raw.pool_mode as RuntimeConfig['pool_mode'];
  }

  if (raw.max_runtimes !== undefined) {
    if (typeof raw.max_runtimes !== 'number' || !Number.isInteger(raw.max_runtimes) || raw.max_runtimes < 1) {
      throw new SchemaValidationFailedError('runtime.max_runtimes must be a positive integer');
    }
    config.max_runtimes = raw.max_runtimes;
  }

  if (raw.priority !== undefined) {
    if (typeof raw.priority !== 'number' || !Number.isInteger(raw.priority) || raw.priority < 0) {
      throw new SchemaValidationFailedError('runtime.priority must be a non-negative integer');
    }
    config.priority = raw.priority;
  }

  if (raw.idle_timeout_seconds !== undefined) {
    if (typeof raw.idle_timeout_seconds !== 'number' || !Number.isInteger(raw.idle_timeout_seconds) || raw.idle_timeout_seconds < 0) {
      throw new SchemaValidationFailedError('runtime.idle_timeout_seconds must be a non-negative integer');
    }
    config.idle_timeout_seconds = raw.idle_timeout_seconds;
  }

  if (raw.grace_period_seconds !== undefined) {
    if (typeof raw.grace_period_seconds !== 'number' || !Number.isInteger(raw.grace_period_seconds) || raw.grace_period_seconds < 0) {
      throw new SchemaValidationFailedError('runtime.grace_period_seconds must be a non-negative integer');
    }
    config.grace_period_seconds = raw.grace_period_seconds;
  }

  if (raw.image !== undefined) {
    if (typeof raw.image !== 'string' || raw.image.trim().length === 0) {
      throw new SchemaValidationFailedError('runtime.image must be a non-empty string');
    }
    config.image = raw.image;
  }

  if (raw.pull_policy !== undefined) {
    if (typeof raw.pull_policy !== 'string' || !allowedPullPolicies.has(raw.pull_policy)) {
      throw new SchemaValidationFailedError(
        `runtime.pull_policy must be 'always', 'if-not-present', or 'never', got '${String(raw.pull_policy)}'`,
      );
    }
    config.pull_policy = raw.pull_policy as RuntimeConfig['pull_policy'];
  }

  if (raw.cpu !== undefined) {
    if (typeof raw.cpu !== 'string' || raw.cpu.trim().length === 0) {
      throw new SchemaValidationFailedError('runtime.cpu must be a non-empty string');
    }
    config.cpu = raw.cpu;
  }

  if (raw.memory !== undefined) {
    if (typeof raw.memory !== 'string' || raw.memory.trim().length === 0) {
      throw new SchemaValidationFailedError('runtime.memory must be a non-empty string');
    }
    config.memory = raw.memory;
  }

  return config;
}

function validateTaskContainerConfig(
  raw: unknown,
  runtimeConfig: RuntimeConfig | undefined,
): TaskContainerConfig | undefined {
  if (raw === undefined) return undefined;
  if (!isObject(raw)) {
    throw new SchemaValidationFailedError("Template field 'task_container' must be an object");
  }

  const config: TaskContainerConfig = {};

  if (raw.pool_mode !== undefined) {
    if (typeof raw.pool_mode !== 'string' || !allowedPoolModes.has(raw.pool_mode)) {
      throw new SchemaValidationFailedError(
        `task_container.pool_mode must be 'warm' or 'cold', got '${String(raw.pool_mode)}'`,
      );
    }
    if (raw.pool_mode === 'warm') {
      const runtimePoolMode = runtimeConfig?.pool_mode ?? 'warm';
      if (runtimePoolMode === 'cold') {
        throw new SchemaValidationFailedError(
          "task_container.pool_mode cannot be 'warm' when runtime.pool_mode is 'cold'",
        );
      }
    }
    config.pool_mode = raw.pool_mode as TaskContainerConfig['pool_mode'];
  }

  if (raw.warm_pool_size !== undefined) {
    if (typeof raw.warm_pool_size !== 'number' || !Number.isInteger(raw.warm_pool_size) || raw.warm_pool_size < 0) {
      throw new SchemaValidationFailedError('task_container.warm_pool_size must be a non-negative integer');
    }
    config.warm_pool_size = raw.warm_pool_size;
  }

  if (raw.image !== undefined) {
    if (typeof raw.image !== 'string') {
      throw new SchemaValidationFailedError('task_container.image must be a string');
    }
    config.image = raw.image;
  }

  if (raw.pull_policy !== undefined) {
    if (typeof raw.pull_policy !== 'string' || !allowedPullPolicies.has(raw.pull_policy)) {
      throw new SchemaValidationFailedError(
        `task_container.pull_policy must be 'always', 'if-not-present', or 'never', got '${String(raw.pull_policy)}'`,
      );
    }
    config.pull_policy = raw.pull_policy as TaskContainerConfig['pull_policy'];
  }

  if (raw.cpu !== undefined) {
    if (typeof raw.cpu !== 'string' || raw.cpu.trim().length === 0) {
      throw new SchemaValidationFailedError('task_container.cpu must be a non-empty string');
    }
    config.cpu = raw.cpu;
  }

  if (raw.memory !== undefined) {
    if (typeof raw.memory !== 'string' || raw.memory.trim().length === 0) {
      throw new SchemaValidationFailedError('task_container.memory must be a non-empty string');
    }
    config.memory = raw.memory;
  }

  return config;
}

const allowedOutputStorageModes = new Set<OutputStorageMode>(['inline', 'artifact', 'git']);

export function deriveWorkflowState(taskStates: string[]): WorkflowState {
  if (taskStates.length === 0) {
    return 'pending';
  }

  if (taskStates.some((state) => state === 'failed')) {
    return 'failed';
  }

  const terminalStates = new Set(['completed', 'failed', 'cancelled']);
  const allTerminal = taskStates.every((state) => terminalStates.has(state));

  if (allTerminal) {
    if (taskStates.every((state) => state === 'completed')) return 'completed';
    if (taskStates.every((state) => state === 'cancelled')) return 'cancelled';
    return 'failed';
  }

  if (taskStates.some((state) => state === 'running' || state === 'claimed')) return 'active';
  if (
    taskStates.some((state) => state === 'awaiting_approval' || state === 'output_pending_review')
  )
    return 'paused';
  return 'pending';
}

export function detectDependencyCycle(
  tasks: Pick<TemplateTaskDefinition, 'id' | 'depends_on'>[],
): string[] | null {
  const taskIds = new Set(tasks.map((task) => task.id));
  const adjacency = new Map<string, string[]>();

  for (const task of tasks) {
    adjacency.set(
      task.id,
      (task.depends_on ?? []).filter((dep) => taskIds.has(dep)),
    );
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();
  const stack: string[] = [];

  const visit = (node: string): string[] | null => {
    visited.add(node);
    inStack.add(node);
    stack.push(node);

    for (const dep of adjacency.get(node) ?? []) {
      if (!visited.has(dep)) {
        const cycle = visit(dep);
        if (cycle) return cycle;
      } else if (inStack.has(dep)) {
        const cycleStart = stack.indexOf(dep);
        return [...stack.slice(cycleStart), dep];
      }
    }

    stack.pop();
    inStack.delete(node);
    return null;
  };

  for (const task of tasks) {
    if (!visited.has(task.id)) {
      const cycle = visit(task.id);
      if (cycle) return cycle;
    }
  }

  return null;
}

function assertObject(value: unknown, message: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SchemaValidationFailedError(message);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeOutputStateDeclaration(
  taskId: string,
  rawValue: unknown,
): Record<string, OutputStateDeclaration> | undefined {
  if (rawValue === undefined) {
    return undefined;
  }
  if (!isObject(rawValue)) {
    throw new SchemaValidationFailedError(
      `Task '${taskId}' field 'output_state' must be an object`,
    );
  }

  const normalized: Record<string, OutputStateDeclaration> = {};
  for (const [field, declaration] of Object.entries(rawValue)) {
    if (typeof field !== 'string' || field.trim().length === 0) {
      throw new SchemaValidationFailedError(
        `Task '${taskId}' field 'output_state' contains an invalid key`,
      );
    }

    const normalizedDeclaration =
      typeof declaration === 'string'
        ? { mode: declaration }
        : isObject(declaration)
          ? declaration
          : null;
    if (!normalizedDeclaration) {
      throw new SchemaValidationFailedError(
        `Task '${taskId}' output_state declaration for '${field}' must be a string mode or object`,
      );
    }

    if (
      typeof normalizedDeclaration.mode !== 'string' ||
      !allowedOutputStorageModes.has(normalizedDeclaration.mode as OutputStorageMode)
    ) {
      throw new SchemaValidationFailedError(
        `Task '${taskId}' output_state declaration for '${field}' has invalid mode '${String(normalizedDeclaration.mode)}'`,
      );
    }

    normalized[field] = {
      mode: normalizedDeclaration.mode as OutputStorageMode,
      path:
        typeof normalizedDeclaration.path === 'string' &&
        normalizedDeclaration.path.trim().length > 0
          ? normalizedDeclaration.path
          : undefined,
      media_type:
        typeof normalizedDeclaration.media_type === 'string' &&
        normalizedDeclaration.media_type.trim().length > 0
          ? normalizedDeclaration.media_type
          : undefined,
      summary:
        typeof normalizedDeclaration.summary === 'string' &&
        normalizedDeclaration.summary.trim().length > 0
          ? normalizedDeclaration.summary
          : undefined,
    };
  }

  return normalized;
}

export function validateTemplateSchema(input: unknown): TemplateSchema {
  assertObject(input, 'Template schema must be an object');

  const tasksValue = input.tasks;
  if (!Array.isArray(tasksValue) || tasksValue.length === 0) {
    throw new SchemaValidationFailedError('Template schema requires a non-empty tasks array');
  }

  let hasBlockedBy = false;
  let hasDependsOn = false;

  const tasks: TemplateTaskDefinition[] = tasksValue.map((rawTask, index) => {
    assertObject(rawTask, `Task at index ${index} must be an object`);
    if (typeof rawTask.id !== 'string' || !rawTask.id.trim()) {
      throw new SchemaValidationFailedError(
        `Task at index ${index} is missing required string field 'id'`,
      );
    }
    if (typeof rawTask.title_template !== 'string' || !rawTask.title_template.trim()) {
      throw new SchemaValidationFailedError(
        `Task '${rawTask.id}' is missing required string field 'title_template'`,
      );
    }
    if (rawTask.depends_on !== undefined && !Array.isArray(rawTask.depends_on)) {
      throw new SchemaValidationFailedError(
        `Task '${rawTask.id}' field 'depends_on' must be an array`,
      );
    }
    if (rawTask.blocked_by !== undefined && !Array.isArray(rawTask.blocked_by)) {
      throw new SchemaValidationFailedError(
        `Task '${rawTask.id}' field 'blocked_by' must be an array`,
      );
    }
    if (rawTask.depends_on !== undefined && rawTask.blocked_by !== undefined) {
      throw new SchemaValidationFailedError(
        `Task '${rawTask.id}' cannot declare both 'depends_on' and deprecated 'blocked_by'`,
      );
    }
    hasBlockedBy = hasBlockedBy || rawTask.blocked_by !== undefined;
    hasDependsOn = hasDependsOn || rawTask.depends_on !== undefined;

    const rawDependencies =
      (rawTask.depends_on as unknown[] | undefined) ??
      (rawTask.blocked_by as unknown[] | undefined) ??
      [];

    return {
      id: rawTask.id,
      title_template: rawTask.title_template,
      type: rawTask.type as TemplateTaskDefinition['type'],
      role: typeof rawTask.role === 'string' ? rawTask.role : undefined,
      depends_on: rawDependencies.map((dep) => {
        if (typeof dep !== 'string' || !dep.trim()) {
          throw new SchemaValidationFailedError(`Task '${rawTask.id}' has non-string dependency`);
        }
        return dep;
      }),
      blocked_by: (rawTask.blocked_by as unknown[] | undefined)?.map((dep) => String(dep)),
      requires_approval: rawTask.requires_approval === true,
      input_template: isObject(rawTask.input_template) ? rawTask.input_template : undefined,
      context_template: isObject(rawTask.context_template) ? rawTask.context_template : undefined,
      capabilities_required: Array.isArray(rawTask.capabilities_required)
        ? rawTask.capabilities_required.map((capability) => String(capability))
        : undefined,
      role_config: isObject(rawTask.role_config) ? rawTask.role_config : undefined,
      environment: isObject(rawTask.environment) ? rawTask.environment : undefined,
      lifecycle: readTemplateLifecyclePolicy(rawTask.lifecycle, `Task '${rawTask.id}' lifecycle`),
      output_state: normalizeOutputStateDeclaration(rawTask.id, rawTask.output_state),
      timeout_minutes:
        typeof rawTask.timeout_minutes === 'number' ? rawTask.timeout_minutes : undefined,
      auto_retry: rawTask.auto_retry === true,
      max_retries: typeof rawTask.max_retries === 'number' ? rawTask.max_retries : undefined,
      metadata: isObject(rawTask.metadata) ? rawTask.metadata : undefined,
    };
  });

  const idSet = new Set<string>();
  for (const task of tasks) {
    if (idSet.has(task.id))
      throw new ConflictError(`Duplicate task id '${task.id}' in template schema`);
    idSet.add(task.id);
  }

  if (hasBlockedBy && hasDependsOn) {
    throw new SchemaValidationFailedError(
      "Templates cannot mix 'depends_on' and deprecated 'blocked_by' references",
    );
  }

  const dependencyMap = new Map(tasks.map((task) => [task.id, [...(task.depends_on ?? [])]]));

  for (const task of tasks) {
    for (const dep of task.depends_on ?? []) {
      if (dep.includes('.')) {
        continue;
      }
      if (!idSet.has(dep))
        throw new SchemaValidationFailedError(`Task '${task.id}' depends_on unknown task '${dep}'`);
      if (dep === task.id)
        throw new SchemaValidationFailedError(`Task '${task.id}' cannot depend on itself`);
    }
  }

  // FR-712: Validate that no pattern nests another pattern.
  const patternsValue = input.patterns;
  let validatedPatterns: Record<string, unknown> | undefined;
  if (patternsValue !== undefined) {
    if (!isObject(patternsValue)) {
      throw new SchemaValidationFailedError("Template schema field 'patterns' must be an object");
    }
    assertNoPatternNesting(patternsValue);
    validatedPatterns = patternsValue;
  }

  const workflow = validateWorkflowDefinition({
    workflow: input.workflow,
    taskIds: tasks.map((task) => task.id),
    dependencyMap,
    patterns: validatedPatterns,
  });

  const dependencyMapWithPhaseRules = applySequentialPhaseDependencies(workflow, dependencyMap);
  for (const task of tasks) {
    task.depends_on = dependencyMapWithPhaseRules.get(task.id) ?? [];
  }

  const cyclePath = detectDependencyCycle(
    tasks.map((task) => ({
      ...task,
      depends_on: (task.depends_on ?? []).filter((dep) => !dep.includes('.')),
    })),
  );
  if (cyclePath) {
    throw new CycleDetectedError('Template dependency graph contains a cycle', {
      cycle_path: cyclePath,
    });
  }

  const runtimeConfig = validateRuntimeConfig(input.runtime);
  const taskContainerConfig = validateTaskContainerConfig(input.task_container, runtimeConfig);

  return {
    variables: parseTemplateVariables(input.variables),
    tasks,
    workflow,
    runtime: runtimeConfig,
    task_container: taskContainerConfig,
    config: isObject(input.config) ? input.config : undefined,
    config_policy: isObject(input.config_policy) ? input.config_policy : undefined,
    default_instruction_config: isObject(input.default_instruction_config)
      ? input.default_instruction_config
      : undefined,
    lifecycle: readTemplateLifecyclePolicy(input.lifecycle, 'Template lifecycle'),
    patterns: validatedPatterns,
    metadata: isObject(input.metadata) ? input.metadata : undefined,
  };
}
