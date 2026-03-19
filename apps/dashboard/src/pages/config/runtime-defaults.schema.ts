import type { FieldDefinition, SectionDefinition } from './runtime-defaults.types.js';
import {
  RUNTIME_OPERATION_FIELD_DEFINITIONS,
  RUNTIME_OPERATION_SECTION_DEFINITIONS,
} from './runtime-defaults-runtime-ops.js';

export const PULL_POLICY_OPTIONS = ['always', 'if-not-present', 'never'] as const;
export const PLATFORM_DEFAULT_SELECT_VALUE = '__default__';
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

const BASE_SECTION_DEFINITIONS: SectionDefinition[] = [
  {
    key: 'containers',
    title: 'Agent container defaults',
    description: 'Default image and resource limits applied to agent containers.',
  },
  {
    key: 'agent_context',
    title: 'Agent context handling',
    description:
      'Tune specialist history retention and compaction so long-running tasks stay concise without losing recent execution context.',
  },
  {
    key: 'orchestrator_context',
    title: 'Orchestrator context overrides',
    description:
      'Give orchestrator activations a different retention or compaction posture when planning and review require more context than specialist execution.',
  },
  {
    key: 'agent_safeguards',
    title: 'Agent safeguards',
    description:
      'Control repetition detection, intervention limits, and hard iteration ceilings for agent loops.',
  },
  {
    key: 'fleet',
    title: 'Fleet limits',
    description: 'Global concurrency and capacity settings that affect all playbooks.',
  },
];

const BASE_FIELD_DEFINITIONS: FieldDefinition[] = [
  {
    key: 'default_runtime_image',
    label: 'Runtime image',
    description: 'Docker image used for agent containers unless a playbook overrides it.',
    configType: 'string',
    placeholder: 'agirunner-runtime:local',
    section: 'containers',
  },
  {
    key: 'default_cpu',
    label: 'Default CPU allocation',
    description: 'CPU allocation per container. Use 0 only when you intentionally want no limit.',
    configType: 'string',
    placeholder: '1',
    section: 'containers',
  },
  {
    key: 'default_memory',
    label: 'Default memory allocation',
    description: 'Memory allocation per container, for example 512m or 1g.',
    configType: 'string',
    placeholder: '512m',
    section: 'containers',
  },
  {
    key: 'default_pull_policy',
    label: 'Image pull policy',
    description: 'When the runtime should pull container images from the registry.',
    configType: 'string',
    placeholder: 'if-not-present',
    section: 'containers',
    options: PULL_POLICY_OPTIONS,
  },
  {
    key: 'default_idle_timeout_seconds',
    label: 'Idle timeout (seconds)',
    description: 'How long an idle warm runtime may sit before the fleet can clean it up.',
    configType: 'number',
    placeholder: '300',
    section: 'containers',
    inputMode: 'numeric',
    min: 0,
    step: 1,
  },
  {
    key: 'default_grace_period',
    label: 'Grace period (seconds)',
    description: 'How long a runtime gets to finish work before forced shutdown.',
    configType: 'number',
    placeholder: '30',
    section: 'containers',
    inputMode: 'numeric',
    min: 1,
    step: 1,
  },
  {
    key: 'agent.history_max_messages',
    label: 'History budget (messages)',
    description: 'Maximum message history kept before specialist task context is compacted.',
    configType: 'number',
    placeholder: '100',
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
    placeholder: '20',
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
    section: 'agent_context',
    inputMode: 'numeric',
    min: 1,
    step: 1,
  },
  {
    key: 'agent.specialist_context_strategy',
    label: 'Specialist context strategy',
    description:
      'Default specialist continuity strategy. Auto prefers semantic handling and can adopt provider-native compaction when the runtime explicitly supports it.',
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
      'Role-specific compaction threshold for specialists. Clear it to fall back to the base compaction threshold.',
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
      'Role-specific preserved recent message count for specialists. Clear it to use the base preserved tail.',
    configType: 'number',
    placeholder: '20',
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
    label: 'No-change intervention threshold',
    description:
      'Intervene after this many file-mutating turns with no actual workspace change.',
    configType: 'number',
    placeholder: '5',
    section: 'agent_safeguards',
    inputMode: 'numeric',
    min: 1,
    step: 1,
  },
  {
    key: 'agent.max_stuck_interventions',
    label: 'Maximum stuck interventions',
    description:
      'How many automatic recovery interventions the runtime attempts before failing the task.',
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
    placeholder: '500',
    section: 'agent_safeguards',
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
    key: 'global_max_runtimes',
    label: 'Global runtime cap',
    description: 'Maximum concurrent agent containers across all playbooks.',
    configType: 'number',
    placeholder: '10',
    section: 'fleet',
    inputMode: 'numeric',
    min: 1,
    step: 1,
  },
];

export const SECTION_DEFINITIONS: SectionDefinition[] = [
  ...BASE_SECTION_DEFINITIONS.slice(0, 1),
  ...RUNTIME_OPERATION_SECTION_DEFINITIONS,
  ...BASE_SECTION_DEFINITIONS.slice(1),
];

export const FIELD_DEFINITIONS: FieldDefinition[] = [
  ...BASE_FIELD_DEFINITIONS.slice(0, 5),
  ...RUNTIME_OPERATION_FIELD_DEFINITIONS,
  ...BASE_FIELD_DEFINITIONS.slice(5),
];

export function fieldsForSection(sectionKey: FieldDefinition['section']): FieldDefinition[] {
  return FIELD_DEFINITIONS.filter((field) => field.section === sectionKey);
}
