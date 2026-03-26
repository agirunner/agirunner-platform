import type {
  FieldDefinition,
  SectionColumnLayout,
  SectionDefinition,
} from './runtime-defaults.types.js';
import {
  RUNTIME_OPERATION_FIELD_DEFINITIONS,
  RUNTIME_OPERATION_SECTION_DEFINITIONS,
} from './runtime-defaults-runtime-ops.js';

export const PULL_POLICY_OPTIONS = ['always', 'if-not-present', 'never'] as const;
export const SPECIALIST_CONTEXT_STRATEGY_OPTIONS = [
  'auto',
  'semantic_local',
  'deterministic',
  'provider_native',
  'off',
] as const;
export const ORCHESTRATOR_CONTEXT_STRATEGY_OPTIONS = [
  'activation_checkpoint',
  'emergency_only',
  'off',
] as const;
export const BOOLEAN_OPTIONS = ['true', 'false'] as const;

const RUNTIME_OPERATION_RUNTIME_SECTION_KEYS = new Set<FieldDefinition['section']>([
  'task_limits',
  'server_timeouts',
  'tool_timeouts',
  'lifecycle_timeouts',
  'connected_platform',
  'workspace_timeouts',
  'capture_timeouts',
  'secrets_timeouts',
  'subagent_timeouts',
]);

const PLATFORM_OPERATION_SECTION_KEYS = new Set<FieldDefinition['section']>([
  'task_timeouts',
  'realtime_transport',
  'workflow_activation',
  'container_manager',
  'worker_supervision',
  'agent_supervision',
  'platform_loops',
]);

const OPERATIONS_CONNECTED_PLATFORM_FIELD_KEYS = new Set<string>([
  'platform.api_request_timeout_seconds',
  'platform.log_ingest_timeout_seconds',
  'platform.log_flush_interval_ms',
  'platform.heartbeat_max_failures',
  'platform.cancellation_report_timeout_seconds',
  'platform.drain_timeout_seconds',
  'platform.self_terminate_cleanup_timeout_seconds',
]);

const BASE_SECTION_DEFINITIONS: SectionDefinition[] = [
  {
    key: 'runtime_containers',
    title: 'Specialist agent defaults',
    description:
      'Default image and resource limits for short-lived specialist agents that host the agent loop. This image is different from the environment where your specialists execute their tasks. This small alpine-based image is optimized for running the agentic loop, not for executing complex tasks.',
    defaultExpanded: true,
  },
  {
    key: 'task_limits',
    title: 'Workload Limits & Backlog',
    description:
      'Set specialist loop ceilings, active-specialist capacity, and queued backlog limits.',
    defaultExpanded: true,
  },
  {
    key: 'agent_context',
    title: 'Specialist Context',
    description:
      'Tune specialist history retention and compaction so long-running tasks stay concise without losing recent execution context.',
  },
  {
    key: 'orchestrator_context',
    title: 'Orchestrator Context',
    description:
      'Give orchestrator activations a different retention or compaction posture when planning and review require more context than specialist execution.',
  },
  {
    key: 'agent_safeguards',
    title: 'Loop Safeguards & Retries',
    description:
      'Control repetition detection, intervention limits, and hard iteration ceilings for agent loops.',
  },
];

const BASE_FIELD_DEFINITIONS: FieldDefinition[] = [
  {
    key: 'specialist_runtime_default_image',
    label: 'Image',
    description: 'Image used for short-lived specialist agents.',
    configType: 'string',
    placeholder: 'agirunner-runtime:local',
    section: 'runtime_containers',
  },
  {
    key: 'specialist_runtime_default_cpu',
    label: 'CPU',
    description: 'CPU allocation per specialist agent.',
    configType: 'string',
    placeholder: '2',
    section: 'runtime_containers',
  },
  {
    key: 'specialist_runtime_default_memory',
    label: 'Memory',
    description: 'Memory allocation per specialist agent, for example 256m or 1Gi.',
    configType: 'string',
    placeholder: '256m',
    section: 'runtime_containers',
  },
  {
    key: 'specialist_runtime_default_pull_policy',
    label: 'Pull policy',
    description: 'When specialist agent images should be pulled from the registry.',
    configType: 'string',
    placeholder: 'if-not-present',
    section: 'runtime_containers',
    options: PULL_POLICY_OPTIONS,
  },
  {
    key: 'agent.history_max_messages',
    label: 'History budget (messages)',
    description: 'Maximum message history kept before specialist task context is compacted.',
    configType: 'number',
    placeholder: '150',
    section: 'agent_context',
    inputMode: 'numeric',
    min: 1,
    step: 1,
  },
  {
    key: 'agent.history_preserve_recent',
    label: 'Base preserved recent messages',
    description:
      'Shared fallback tail preserved during compaction when a specialist or orchestrator-specific override is not set.',
    configType: 'number',
    placeholder: '30',
    section: 'agent_context',
    inputMode: 'numeric',
    min: 1,
    step: 1,
  },
  {
    key: 'agent.context_compaction_threshold',
    label: 'Base compaction threshold',
    description:
      'Shared fallback threshold used when a role-specific compaction threshold is not set.',
    configType: 'number',
    placeholder: '0.8',
    section: 'agent_context',
    inputMode: 'decimal',
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    key: 'agent.context_compaction_chars_per_token',
    label: 'Characters per token estimate',
    description: 'Fallback estimate used when model-side token accounting is unavailable.',
    configType: 'number',
    placeholder: '4',
    defaultValue: '4',
    section: 'agent_context',
    inputMode: 'numeric',
    min: 1,
    step: 1,
  },
  {
    key: 'agent.specialist_context_strategy',
    label: 'Specialist context strategy',
    description:
      'Default specialist continuity strategy. Auto prefers semantic handling and can adopt provider-native compaction when the active specialist agent path explicitly supports it.',
    configType: 'string',
    placeholder: 'auto',
    section: 'agent_context',
    options: SPECIALIST_CONTEXT_STRATEGY_OPTIONS,
  },
  {
    key: 'agent.specialist_context_warning_threshold',
    label: 'Specialist warning threshold',
    description:
      'Warn specialists about rising context pressure before compaction starts.',
    configType: 'number',
    placeholder: '0.7',
    section: 'agent_context',
    inputMode: 'decimal',
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    key: 'agent.specialist_context_compaction_threshold',
    label: 'Specialist compaction threshold override',
    description:
      'Role-specific compaction threshold used for specialist continuity handling.',
    configType: 'number',
    placeholder: '0.8',
    section: 'agent_context',
    inputMode: 'decimal',
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    key: 'agent.specialist_context_tail_messages',
    label: 'Specialist preserved tail',
    description:
      'Role-specific preserved recent message count used for specialist continuity handling.',
    configType: 'number',
    placeholder: '30',
    section: 'agent_context',
    inputMode: 'numeric',
    min: 1,
    step: 1,
  },
  {
    key: 'agent.specialist_context_preserve_memory_ops',
    label: 'Preserve recent memory ops',
    description:
      'How many recent specialist memory breadcrumbs must survive compaction.',
    configType: 'number',
    placeholder: '2',
    defaultValue: '3',
    section: 'agent_context',
    inputMode: 'numeric',
    min: 0,
    step: 1,
  },
  {
    key: 'agent.specialist_context_preserve_artifact_ops',
    label: 'Preserve recent artifact ops',
    description:
      'How many recent specialist artifact breadcrumbs must survive compaction.',
    configType: 'number',
    placeholder: '2',
    defaultValue: '3',
    section: 'agent_context',
    inputMode: 'numeric',
    min: 0,
    step: 1,
  },
  {
    key: 'agent.specialist_prepare_for_compaction_enabled',
    label: 'Run specialist pre-compaction prepare',
    description:
      'Ask specialists to checkpoint durable memory and transient continuity before compaction.',
    configType: 'boolean',
    placeholder: 'true',
    section: 'agent_context',
    options: BOOLEAN_OPTIONS,
  },
  {
    key: 'agent.orchestrator_history_preserve_recent',
    label: 'Orchestrator preserved recent messages',
    description:
      'Emergency-only preserved tail for unusually long orchestrator activations.',
    configType: 'number',
    placeholder: '30',
    section: 'orchestrator_context',
    inputMode: 'numeric',
    min: 0,
    step: 1,
  },
  {
    key: 'agent.orchestrator_context_compaction_threshold',
    label: 'Legacy orchestrator compaction threshold',
    description:
      'Compatibility threshold for emergency orchestrator compaction. Prefer the explicit orchestrator strategy and emergency threshold below.',
    configType: 'number',
    placeholder: '0.9',
    section: 'orchestrator_context',
    inputMode: 'decimal',
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    key: 'agent.orchestrator_context_strategy',
    label: 'Orchestrator context strategy',
    description:
      'Default orchestrator continuity strategy. Activation checkpoint is recommended because orchestrators run short activations and resume from persisted state.',
    configType: 'string',
    placeholder: 'activation_checkpoint',
    section: 'orchestrator_context',
    options: ORCHESTRATOR_CONTEXT_STRATEGY_OPTIONS,
  },
  {
    key: 'agent.orchestrator_finish_checkpoint_enabled',
    label: 'Persist activation finish checkpoint',
    description:
      'Persist an orchestrator activation checkpoint before the activation exits.',
    configType: 'boolean',
    placeholder: 'true',
    section: 'orchestrator_context',
    options: BOOLEAN_OPTIONS,
  },
  {
    key: 'agent.orchestrator_finish_refresh_context_bundle',
    label: 'Refresh context bundle on finish',
    description:
      'Refresh attached context files after orchestrator finish persistence so the current activation can inspect the stored checkpoint and memory index.',
    configType: 'boolean',
    placeholder: 'true',
    section: 'orchestrator_context',
    options: BOOLEAN_OPTIONS,
  },
  {
    key: 'agent.orchestrator_emergency_compaction_threshold',
    label: 'Orchestrator emergency compaction threshold',
    description:
      'Only used when an orchestrator activation runs abnormally long and needs emergency compaction.',
    configType: 'number',
    placeholder: '0.95',
    section: 'orchestrator_context',
    inputMode: 'decimal',
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    key: 'agent.orchestrator_preserve_memory_ops',
    label: 'Orchestrator preserved memory ops',
    description:
      'How many recent orchestrator memory breadcrumbs should survive emergency compaction.',
    configType: 'number',
    placeholder: '2',
    section: 'orchestrator_context',
    inputMode: 'numeric',
    min: 0,
    step: 1,
  },
  {
    key: 'agent.orchestrator_preserve_artifact_ops',
    label: 'Orchestrator preserved artifact ops',
    description:
      'How many recent orchestrator artifact breadcrumbs should survive emergency compaction.',
    configType: 'number',
    placeholder: '2',
    section: 'orchestrator_context',
    inputMode: 'numeric',
    min: 0,
    step: 1,
  },
  {
    key: 'agent.loop_detection_repeat',
    label: 'Loop detection repeat count',
    description: 'Flag repeated loop patterns after this many repeated turns.',
    configType: 'number',
    placeholder: '3',
    section: 'agent_safeguards',
    inputMode: 'numeric',
    min: 1,
    step: 1,
  },
  {
    key: 'agent.response_repeat_threshold',
    label: 'Repeated response threshold',
    description: 'Mark the agent as stuck after this many repeated near-identical replies.',
    configType: 'number',
    placeholder: '2',
    section: 'agent_safeguards',
    inputMode: 'numeric',
    min: 1,
    step: 1,
  },
  {
    key: 'agent.no_file_change_threshold',
    label: 'No-progress intervention threshold',
    description:
      'Intervene only after this many turns with no meaningful progress toward task completion.',
    configType: 'number',
    placeholder: '50',
    section: 'agent_safeguards',
    inputMode: 'numeric',
    min: 1,
    step: 1,
  },
  {
    key: 'agent.max_tool_steps_per_burst',
    label: 'Maximum tool steps per burst',
    description:
      'How many tool steps a reactive loop may execute before it must stop and re-evaluate progress.',
    configType: 'number',
    placeholder: '12',
    section: 'agent_safeguards',
    inputMode: 'numeric',
    min: 1,
    step: 1,
  },
  {
    key: 'agent.max_mutating_steps_per_burst',
    label: 'Maximum mutating steps per burst',
    description:
      'How many mutating tool steps a reactive loop may execute before it must stop and re-evaluate progress.',
    configType: 'number',
    placeholder: '5',
    section: 'agent_safeguards',
    inputMode: 'numeric',
    min: 1,
    step: 1,
  },
  {
    key: 'agent.max_burst_elapsed_ms',
    label: 'Maximum burst elapsed time (ms)',
    description:
      'How long a reactive burst may run before the specialist agent forces a new planning boundary.',
    configType: 'number',
    placeholder: '120000',
    section: 'agent_safeguards',
    inputMode: 'numeric',
    min: 1,
    step: 1,
  },
  {
    key: 'agent.max_parallel_tool_calls_per_burst',
    label: 'Maximum parallel tool calls per burst',
    description:
      'How many read-only tool calls a reactive burst may execute in parallel before the specialist agent throttles concurrency.',
    configType: 'number',
    placeholder: '8',
    section: 'agent_safeguards',
    inputMode: 'numeric',
    min: 1,
    step: 1,
  },
  {
    key: 'agent.max_stuck_interventions',
    label: 'Maximum stuck interventions',
    description:
      'How many automatic recovery interventions the specialist agent attempts before failing the task.',
    configType: 'number',
    placeholder: '2',
    section: 'agent_safeguards',
    inputMode: 'numeric',
    min: 0,
    step: 1,
  },
  {
    key: 'agent.max_iterations',
    label: 'Maximum task iterations',
    description: 'Hard stop on agent loop iterations for a single task.',
    configType: 'number',
    placeholder: '800',
    section: 'task_limits',
    inputMode: 'numeric',
    min: 1,
    step: 1,
  },
  {
    key: 'agent.llm_max_retries',
    label: 'LLM retry attempts',
    description: 'Maximum retries for failed model calls before the task errors.',
    configType: 'number',
    placeholder: '5',
    section: 'agent_safeguards',
    inputMode: 'numeric',
    min: 1,
    step: 1,
  },
  {
    key: 'global_max_specialists',
    label: 'Max active specialists',
    description:
      'Maximum concurrent specialist tasks. Each active specialist consumes one specialist agent and one specialist execution.',
    configType: 'number',
    placeholder: '20',
    section: 'task_limits',
    inputMode: 'numeric',
    min: 1,
    step: 1,
  },
];

export const SECTION_DEFINITIONS: SectionDefinition[] = [
  BASE_SECTION_DEFINITIONS[0],
  BASE_SECTION_DEFINITIONS[1],
  ...RUNTIME_OPERATION_SECTION_DEFINITIONS.filter((section) =>
    RUNTIME_OPERATION_RUNTIME_SECTION_KEYS.has(section.key),
  ),
  ...BASE_SECTION_DEFINITIONS.slice(2),
];

export const PRIMARY_RUNTIME_DEFAULT_SECTION_KEYS = [
  'runtime_containers',
] as const;

export const RUNTIME_INLINE_SECTION_COLUMNS: SectionColumnLayout = {
  left: [
    'server_timeouts',
    'tool_timeouts',
    'lifecycle_timeouts',
    'workspace_timeouts',
    'capture_timeouts',
  ],
  right: [
    'task_limits',
    'connected_platform',
    'secrets_timeouts',
    'subagent_timeouts',
    'agent_context',
    'orchestrator_context',
    'agent_safeguards',
  ],
};

export const FIELD_DEFINITIONS: FieldDefinition[] = [
  ...BASE_FIELD_DEFINITIONS.slice(0, 4),
  ...RUNTIME_OPERATION_FIELD_DEFINITIONS.filter(
    (field) =>
      RUNTIME_OPERATION_RUNTIME_SECTION_KEYS.has(field.section)
      && !OPERATIONS_CONNECTED_PLATFORM_FIELD_KEYS.has(field.key)
      && field.key !== 'specialist_runtime_drain_grace_seconds',
  ),
  ...BASE_FIELD_DEFINITIONS.slice(4),
];

function fieldByKey(key: string): FieldDefinition {
  const field = RUNTIME_OPERATION_FIELD_DEFINITIONS.find((candidate) => candidate.key === key);
  if (!field) {
    throw new Error(`Missing runtime default field definition for ${key}`);
  }
  return field;
}

function operationSectionByKey(key: FieldDefinition['section']): SectionDefinition {
  const section = RUNTIME_OPERATION_SECTION_DEFINITIONS.find((candidate) => candidate.key === key);
  if (!section) {
    throw new Error(`Missing runtime default section definition for ${key}`);
  }
  return section;
}

export const OPERATIONS_SECTION_DEFINITIONS: SectionDefinition[] = [
  operationSectionByKey('task_timeouts'),
  {
    ...operationSectionByKey('connected_platform'),
    title: 'Platform Connection & Reporting',
    description:
      'Tune API, log, drain, and cleanup behavior for platform-connected specialist agents.',
  },
  {
    ...operationSectionByKey('container_manager'),
    description:
      'Control specialist agent drain timing plus container reconcile, shutdown, and log-management behavior.',
  },
  operationSectionByKey('worker_supervision'),
  operationSectionByKey('realtime_transport'),
  operationSectionByKey('platform_loops'),
];

export const PRIMARY_OPERATIONS_SECTION_KEYS = [] as const;

export const OPERATIONS_INLINE_SECTION_COLUMNS: SectionColumnLayout = {
  left: [
    'task_timeouts',
    'connected_platform',
    'container_manager',
  ],
  right: [
    'worker_supervision',
    'realtime_transport',
    'platform_loops',
  ],
};

export const OPERATIONS_FIELD_DEFINITIONS: FieldDefinition[] = [
  {
    ...fieldByKey('specialist_runtime_drain_grace_seconds'),
    section: 'container_manager',
  },
  fieldByKey('tasks.default_timeout_minutes'),
  ...RUNTIME_OPERATION_FIELD_DEFINITIONS.filter(
    (field) =>
      (PLATFORM_OPERATION_SECTION_KEYS.has(field.section)
        || OPERATIONS_CONNECTED_PLATFORM_FIELD_KEYS.has(field.key))
      && field.key !== 'tasks.default_timeout_minutes'
      && field.key !== 'specialist_runtime_drain_grace_seconds',
  ).map((field) => {
    if (field.section === 'workflow_activation') {
      return { ...field, section: 'task_timeouts' };
    }
    if (field.section === 'agent_supervision') {
      return { ...field, section: 'worker_supervision' };
    }
    return field;
  }),
];

export function fieldsForSection(
  sectionKey: FieldDefinition['section'],
  fieldDefinitions: FieldDefinition[] = FIELD_DEFINITIONS,
): FieldDefinition[] {
  return fieldDefinitions.filter((field) => field.section === sectionKey);
}
