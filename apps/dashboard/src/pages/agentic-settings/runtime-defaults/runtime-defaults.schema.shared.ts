import type { SectionDefinition } from './runtime-defaults.types.js';

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

export const BASE_SECTION_DEFINITIONS: SectionDefinition[] = [
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
