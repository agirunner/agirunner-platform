import { ConflictError, SchemaValidationFailedError } from '../errors/domain-errors.js';
import { parseTemplateVariables, type TemplateVariableDefinition } from './template-variables.js';

export type PipelineState = 'pending' | 'active' | 'completed' | 'failed' | 'cancelled' | 'paused';

export interface TemplateTaskDefinition {
  id: string;
  title_template: string;
  type: 'analysis' | 'code' | 'review' | 'test' | 'docs' | 'orchestration' | 'custom';
  role?: string;
  depends_on?: string[];
  requires_approval?: boolean;
  input_template?: Record<string, unknown>;
  capabilities_required?: string[];
  role_config?: Record<string, unknown>;
  environment?: Record<string, unknown>;
  timeout_minutes?: number;
  auto_retry?: boolean;
  max_retries?: number;
  metadata?: Record<string, unknown>;
}

export interface TemplateSchema {
  variables?: TemplateVariableDefinition[];
  tasks: TemplateTaskDefinition[];
  metadata?: Record<string, unknown>;
}

const allowedTaskTypes = new Set(['analysis', 'code', 'review', 'test', 'docs', 'orchestration', 'custom']);

export function derivePipelineState(taskStates: string[]): PipelineState {
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
  if (taskStates.some((state) => state === 'awaiting_approval' || state === 'output_pending_review')) return 'paused';
  return 'pending';
}

export function detectDependencyCycle(tasks: Pick<TemplateTaskDefinition, 'id' | 'depends_on'>[]): string[] | null {
  const taskIds = new Set(tasks.map((task) => task.id));
  const adjacency = new Map<string, string[]>();

  for (const task of tasks) {
    adjacency.set(task.id, (task.depends_on ?? []).filter((dep) => taskIds.has(dep)));
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

export function validateTemplateSchema(input: unknown): TemplateSchema {
  assertObject(input, 'Template schema must be an object');

  const tasksValue = input.tasks;
  if (!Array.isArray(tasksValue) || tasksValue.length === 0) {
    throw new SchemaValidationFailedError('Template schema requires a non-empty tasks array');
  }

  const tasks: TemplateTaskDefinition[] = tasksValue.map((rawTask, index) => {
    assertObject(rawTask, `Task at index ${index} must be an object`);
    if (typeof rawTask.id !== 'string' || !rawTask.id.trim()) {
      throw new SchemaValidationFailedError(`Task at index ${index} is missing required string field 'id'`);
    }
    if (typeof rawTask.title_template !== 'string' || !rawTask.title_template.trim()) {
      throw new SchemaValidationFailedError(`Task '${rawTask.id}' is missing required string field 'title_template'`);
    }
    if (typeof rawTask.type !== 'string' || !allowedTaskTypes.has(rawTask.type)) {
      throw new SchemaValidationFailedError(`Task '${rawTask.id}' has invalid type '${String(rawTask.type)}'`);
    }
    if (rawTask.depends_on !== undefined && !Array.isArray(rawTask.depends_on)) {
      throw new SchemaValidationFailedError(`Task '${rawTask.id}' field 'depends_on' must be an array`);
    }

    return {
      id: rawTask.id,
      title_template: rawTask.title_template,
      type: rawTask.type as TemplateTaskDefinition['type'],
      role: typeof rawTask.role === 'string' ? rawTask.role : undefined,
      depends_on: (rawTask.depends_on as unknown[] | undefined)?.map((dep) => {
        if (typeof dep !== 'string' || !dep.trim()) {
          throw new SchemaValidationFailedError(`Task '${rawTask.id}' has non-string dependency`);
        }
        return dep;
      }),
      requires_approval: rawTask.requires_approval === true,
      input_template: isObject(rawTask.input_template) ? rawTask.input_template : undefined,
      capabilities_required: Array.isArray(rawTask.capabilities_required)
        ? rawTask.capabilities_required.map((capability) => String(capability))
        : undefined,
      role_config: isObject(rawTask.role_config) ? rawTask.role_config : undefined,
      environment: isObject(rawTask.environment) ? rawTask.environment : undefined,
      timeout_minutes: typeof rawTask.timeout_minutes === 'number' ? rawTask.timeout_minutes : undefined,
      auto_retry: rawTask.auto_retry === true,
      max_retries: typeof rawTask.max_retries === 'number' ? rawTask.max_retries : undefined,
      metadata: isObject(rawTask.metadata) ? rawTask.metadata : undefined,
    };
  });

  const idSet = new Set<string>();
  for (const task of tasks) {
    if (idSet.has(task.id)) throw new ConflictError(`Duplicate task id '${task.id}' in template schema`);
    idSet.add(task.id);
  }

  for (const task of tasks) {
    for (const dep of task.depends_on ?? []) {
      if (!idSet.has(dep)) throw new SchemaValidationFailedError(`Task '${task.id}' depends_on unknown task '${dep}'`);
      if (dep === task.id) throw new SchemaValidationFailedError(`Task '${task.id}' cannot depend on itself`);
    }
  }

  const cyclePath = detectDependencyCycle(tasks);
  if (cyclePath) {
    throw new ConflictError('Template dependency graph contains a cycle', {
      cycle_path: cyclePath,
      code: 'CYCLE_DETECTED',
    });
  }

  return {
    variables: parseTemplateVariables(input.variables),
    tasks,
    metadata: isObject(input.metadata) ? input.metadata : undefined,
  };
}
