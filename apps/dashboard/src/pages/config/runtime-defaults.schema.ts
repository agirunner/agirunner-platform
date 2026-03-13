import type { FieldDefinition, SectionDefinition } from './runtime-defaults.types.js';

export const PULL_POLICY_OPTIONS = ['always', 'if-not-present', 'never'] as const;
export const WEB_SEARCH_PROVIDER_OPTIONS = ['duckduckgo', 'serper', 'tavily'] as const;
export const PLATFORM_DEFAULT_SELECT_VALUE = '__default__';

export const SECTION_DEFINITIONS: SectionDefinition[] = [
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
  {
    key: 'search',
    title: 'Web research',
    description:
      'Select the runtime web_search provider and any provider-specific endpoint or secret-ref settings.',
  },
];

export const FIELD_DEFINITIONS: FieldDefinition[] = [
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
    label: 'Preserve recent specialist messages',
    description: 'Keep this many of the newest specialist messages untouched during compaction.',
    configType: 'number',
    placeholder: '20',
    section: 'agent_context',
    inputMode: 'numeric',
    min: 1,
    step: 1,
  },
  {
    key: 'agent.context_compaction_threshold',
    label: 'Specialist compaction threshold',
    description:
      'Compact specialist context once estimated usage reaches this fraction of the available context window.',
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
    key: 'agent.orchestrator_history_preserve_recent',
    label: 'Preserve recent orchestrator messages',
    description: 'Keep this many of the newest orchestrator messages untouched during compaction.',
    configType: 'number',
    placeholder: '30',
    section: 'orchestrator_context',
    inputMode: 'numeric',
    min: 0,
    step: 1,
  },
  {
    key: 'agent.orchestrator_context_compaction_threshold',
    label: 'Orchestrator compaction threshold',
    description:
      'Compact orchestrator context once estimated usage reaches this fraction of the available context window.',
    configType: 'number',
    placeholder: '0.9',
    section: 'orchestrator_context',
    inputMode: 'decimal',
    min: 0,
    max: 1,
    step: 0.01,
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
    placeholder: '25',
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
    placeholder: '3',
    section: 'agent_safeguards',
    inputMode: 'numeric',
    min: 0,
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
  {
    key: 'tools.web_search_provider',
    label: 'Web search provider',
    description:
      'Primary provider used by the runtime for web_search. DuckDuckGo remains the built-in fallback when the configured provider is unavailable.',
    configType: 'string',
    placeholder: 'duckduckgo',
    section: 'search',
  },
  {
    key: 'tools.web_search_base_url',
    label: 'Provider base URL',
    description:
      'Optional override for the selected provider endpoint. Leave blank to use the provider default URL.',
    configType: 'string',
    placeholder: 'https://google.serper.dev/search',
    section: 'search',
  },
  {
    key: 'tools.web_search_api_key_secret_ref',
    label: 'Provider API key secret ref',
    description:
      'Secret reference used when the provider requires an API key, for example secret:SERPER_API_KEY.',
    configType: 'string',
    placeholder: 'secret:SERPER_API_KEY',
    section: 'search',
  },
];

export function fieldsForSection(sectionKey: FieldDefinition['section']): FieldDefinition[] {
  return FIELD_DEFINITIONS.filter((field) => field.section === sectionKey);
}
