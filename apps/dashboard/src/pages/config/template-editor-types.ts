export interface TemplateVariable {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  default_value: string;
  is_required: boolean;
  enum_values: string;
  description: string;
}

export interface ConfigPolicyField {
  field: string;
  default_value: string;
  is_locked: boolean;
  override_level: 'none' | 'per-run' | 'per-task';
}

export interface TaskDefinition {
  id: string;
  name: string;
  type: string;
  role: string;
  depends_on: string[];
  requires_approval: boolean;
  input_template: string;
  output_mode: 'inline' | 'artifact' | 'git' | 'diff';
}

export interface PhaseDefinition {
  id: string;
  name: string;
  gate: 'auto' | 'all_complete' | 'manual' | 'any_complete';
  gate_type: string;
  parallel: boolean;
  tasks: TaskDefinition[];
}

export interface LifecyclePolicy {
  retry: {
    max_attempts: number;
    backoff_strategy: 'exponential' | 'linear' | 'fixed';
    initial_delay_ms: string;
    retryable_error_types: string[];
  };
  escalation: {
    is_enabled: boolean;
    target_role: string;
    instructions: string;
  };
  rework: {
    max_cycles: number;
  };
}

export type PullPolicy = 'always' | 'if-not-present' | 'never';
export type PoolMode = 'warm' | 'cold';

export interface RuntimeConfig {
  pool_mode: PoolMode;
  max_runtimes: number;
  priority: number;
  idle_timeout: number;
  grace_period: number;
  image: string;
  pull_policy: PullPolicy;
  cpu_limit: string;
  memory_limit: string;
}

export interface TaskContainerConfig {
  pool_mode: PoolMode;
  warm_pool_size: number;
  image: string;
  pull_policy: PullPolicy;
  cpu_limit: string;
  memory_limit: string;
}

export interface TemplateDefinition {
  id: string;
  name: string;
  slug?: string;
  description: string;
  version: string;
  status: 'draft' | 'published' | 'archived';
  is_published?: boolean;
  origin: 'custom' | 'built-in' | 'marketplace';
  phases: PhaseDefinition[];
  variables: TemplateVariable[];
  config_policy: ConfigPolicyField[];
  lifecycle: LifecyclePolicy;
  runtime: RuntimeConfig;
  task_container: TaskContainerConfig;
}

export function createEmptyLifecycle(): LifecyclePolicy {
  return {
    retry: {
      max_attempts: 3,
      backoff_strategy: 'exponential',
      initial_delay_ms: '5000',
      retryable_error_types: ['timeout', 'transient_error', 'resource_unavailable'],
    },
    escalation: {
      is_enabled: false,
      target_role: 'architect',
      instructions: '',
    },
    rework: {
      max_cycles: 3,
    },
  };
}

export function createEmptyRuntimeConfig(): RuntimeConfig {
  return {
    pool_mode: 'warm',
    max_runtimes: 2,
    priority: 50,
    idle_timeout: 300,
    grace_period: 30,
    image: 'agirunner-runtime:local',
    pull_policy: 'if-not-present',
    cpu_limit: '1.0',
    memory_limit: '512m',
  };
}

export function createEmptyTaskContainerConfig(): TaskContainerConfig {
  return {
    pool_mode: 'warm',
    warm_pool_size: 1,
    image: 'ubuntu:22.04',
    pull_policy: 'if-not-present',
    cpu_limit: '0.5',
    memory_limit: '256m',
  };
}

export function createEmptyTemplate(id: string): TemplateDefinition {
  return {
    id,
    name: '',
    description: '',
    version: '1.0',
    status: 'draft',
    origin: 'custom',
    phases: [],
    variables: [],
    config_policy: [],
    lifecycle: createEmptyLifecycle(),
    runtime: createEmptyRuntimeConfig(),
    task_container: createEmptyTaskContainerConfig(),
  };
}
