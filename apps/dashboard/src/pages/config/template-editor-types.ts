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
  };
}
