import { describe, expect, it } from 'vitest';

import { FIELD_DEFINITIONS, fieldsForSection, SECTION_DEFINITIONS } from './runtime-defaults.schema.js';
import { buildValidationErrors } from './runtime-defaults.validation.js';
import { summarizeRuntimeDefaultSections } from './runtime-defaults-page.support.js';

describe('runtime defaults page support', () => {
  it('keeps runtime and execution defaults as the primary expanded sections', () => {
    expect(SECTION_DEFINITIONS.map((section) => section.key)).toEqual([
      'runtime_containers',
      'execution_containers',
      'task_limits',
      'capacity_limits',
      'runtime_throughput',
      'server_timeouts',
      'runtime_api',
      'llm_transport',
      'tool_timeouts',
      'container_timeouts',
      'lifecycle_timeouts',
      'task_timeouts',
      'connected_platform',
      'realtime_transport',
      'workflow_activation',
      'container_manager',
      'worker_supervision',
      'agent_supervision',
      'webhook_delivery',
      'platform_loops',
      'workspace_timeouts',
      'workspace_operations',
      'capture_timeouts',
      'secrets_timeouts',
      'subagent_timeouts',
      'agent_context',
      'orchestrator_context',
      'agent_safeguards',
    ]);
    expect(
      SECTION_DEFINITIONS.filter((section) => section.defaultExpanded).map((section) => section.key),
    ).toEqual(['runtime_containers', 'execution_containers', 'task_limits', 'capacity_limits']);

    expect(fieldsForSection('runtime_containers').map((field) => field.key)).toEqual([
      'specialist_runtime_default_image',
      'specialist_runtime_default_cpu',
      'specialist_runtime_default_memory',
      'specialist_runtime_default_pull_policy',
    ]);
    expect(fieldsForSection('execution_containers').map((field) => field.key)).toEqual([
      'specialist_execution_default_image',
      'specialist_execution_default_cpu',
      'specialist_execution_default_memory',
      'specialist_execution_default_pull_policy',
    ]);
    expect(fieldsForSection('task_limits').map((field) => field.key)).toEqual(['agent.max_iterations']);
    expect(fieldsForSection('capacity_limits').map((field) => field.key)).toEqual([
      'global_max_runtimes',
      'global_max_execution_containers',
    ]);
    expect(fieldsForSection('agent_safeguards').map((field) => field.key)).toEqual([
      'agent.loop_detection_repeat',
      'agent.response_repeat_threshold',
      'agent.no_file_change_threshold',
      'agent.max_tool_steps_per_burst',
      'agent.max_mutating_steps_per_burst',
      'agent.max_burst_elapsed_ms',
      'agent.max_parallel_tool_calls_per_burst',
      'agent.max_stuck_interventions',
      'agent.llm_max_retries',
    ]);
    expect(fieldsForSection('runtime_throughput').map((field) => field.key)).toEqual([
      'queue.max_concurrency',
      'queue.max_depth',
    ]);
    expect(fieldsForSection('connected_platform').map((field) => field.key)).toEqual(
      expect.arrayContaining([
        'specialist_runtime_bootstrap_claim_timeout_seconds',
        'specialist_runtime_drain_grace_seconds',
        'platform.claim_poll_seconds',
        'platform.drain_timeout_seconds',
      ]),
    );
  });

  it('validates numeric runtime ranges, capacity limits, and history relationships before save', () => {
    const errors = buildValidationErrors({
      'agent.history_max_messages': '20',
      'agent.history_preserve_recent': '25',
      'agent.specialist_context_tail_messages': '21',
      'agent.context_compaction_threshold': '1.5',
      'agent.specialist_context_strategy': 'invalid',
      'agent.orchestrator_history_preserve_recent': '21',
      'agent.loop_detection_repeat': '0',
      'queue.max_concurrency': '0',
      'capture.push_retries': '-1',
      'subagent.max_depth': '-1',
      global_max_execution_containers: '0',
    });

    expect(errors['agent.history_preserve_recent']).toContain('overall history budget');
    expect(errors['agent.specialist_context_tail_messages']).toContain('overall history budget');
    expect(errors['agent.context_compaction_threshold']).toContain('at most 1');
    expect(errors['agent.specialist_context_strategy']).toContain('must be one of');
    expect(errors['agent.orchestrator_history_preserve_recent']).toContain('overall history budget');
    expect(errors['agent.loop_detection_repeat']).toContain('at least 1');
    expect(errors['queue.max_concurrency']).toContain('at least 1');
    expect(errors['capture.push_retries']).toContain('at least 0');
    expect(errors['subagent.max_depth']).toContain('at least 0');
    expect(errors['global_max_execution_containers']).toContain('at least 1');
  });

  it('describes loop safeguard defaults with platform-authoritative thresholds', () => {
    const loopRepeatField = FIELD_DEFINITIONS.find(
      (field) => field.key === 'agent.loop_detection_repeat',
    );
    const responseRepeatField = FIELD_DEFINITIONS.find(
      (field) => field.key === 'agent.response_repeat_threshold',
    );
    const noProgressField = FIELD_DEFINITIONS.find(
      (field) => field.key === 'agent.no_file_change_threshold',
    );
    const maxToolStepsField = FIELD_DEFINITIONS.find(
      (field) => field.key === 'agent.max_tool_steps_per_burst',
    );
    const maxMutatingStepsField = FIELD_DEFINITIONS.find(
      (field) => field.key === 'agent.max_mutating_steps_per_burst',
    );
    const maxBurstElapsedField = FIELD_DEFINITIONS.find(
      (field) => field.key === 'agent.max_burst_elapsed_ms',
    );
    const maxParallelField = FIELD_DEFINITIONS.find(
      (field) => field.key === 'agent.max_parallel_tool_calls_per_burst',
    );

    expect(loopRepeatField).toMatchObject({
      placeholder: '3',
      description: 'Flag repeated loop patterns after this many repeated turns.',
    });
    expect(responseRepeatField).toMatchObject({
      placeholder: '2',
      description: 'Mark the agent as stuck after this many repeated near-identical replies.',
    });
    expect(noProgressField).toMatchObject({
      label: 'No-progress intervention threshold',
      placeholder: '50',
      description:
        'Intervene only after this many turns with no meaningful progress toward task completion.',
    });
    expect(maxToolStepsField).toMatchObject({
      placeholder: '8',
      description:
        'How many tool steps a reactive loop may execute before it must stop and re-evaluate progress.',
    });
    expect(maxMutatingStepsField).toMatchObject({
      placeholder: '3',
      description:
        'How many mutating tool steps a reactive loop may execute before it must stop and re-evaluate progress.',
    });
    expect(maxBurstElapsedField).toMatchObject({
      placeholder: '45000',
      description:
        'How long a reactive burst may run before the runtime forces a new planning boundary.',
    });
    expect(maxParallelField).toMatchObject({
      placeholder: '4',
      description:
        'How many read-only tool calls a reactive burst may execute in parallel before the runtime throttles concurrency.',
    });
  });

  it('rejects invalid runtime and execution container defaults with recovery guidance', () => {
    const errors = buildValidationErrors({
      specialist_runtime_default_image: 'https://ghcr.io/agirunner/agirunner runtime:latest',
      specialist_runtime_default_cpu: '0',
      specialist_runtime_default_memory: 'banana',
      specialist_execution_default_image: 'https://ghcr.io/agirunner/execution latest',
      specialist_execution_default_cpu: '0',
      specialist_execution_default_memory: 'nope',
    });

    expect(errors['specialist_runtime_default_image']).toContain('image:tag or image@sha256:digest');
    expect(errors['specialist_runtime_default_cpu']).toContain('greater than 0');
    expect(errors['specialist_runtime_default_memory']).toContain('512m, 2g, or 2Gi');
    expect(errors['specialist_execution_default_image']).toContain('image:tag or image@sha256:digest');
    expect(errors['specialist_execution_default_cpu']).toContain('greater than 0');
    expect(errors['specialist_execution_default_memory']).toContain('512m, 2g, or 2Gi');
  });

  it('rejects fractional cpu values for runtime defaults', () => {
    const errors = buildValidationErrors({
      specialist_runtime_default_cpu: '0.5',
      specialist_execution_default_cpu: '0.5',
    });

    expect(errors['specialist_runtime_default_cpu']).toContain('whole number');
    expect(errors['specialist_execution_default_cpu']).toContain('whole number');
  });

  it('rejects worker reconnect ranges where the minimum exceeds the maximum', () => {
    const errors = buildValidationErrors({
      'platform.worker_reconnect_min_ms': '60000',
      'platform.worker_reconnect_max_ms': '1000',
    });

    expect(errors['platform.worker_reconnect_max_ms']).toContain('at least the minimum');
  });

  it('builds section summaries with configured and error counts', () => {
    expect(
      summarizeRuntimeDefaultSections(
        {
          specialist_runtime_default_image: 'agirunner-runtime:local',
          specialist_execution_default_memory: '1Gi',
          'tools.git_push_timeout_seconds': '90',
          'agent.history_max_messages': '100',
          'agent.history_preserve_recent': '25',
        },
        {
          'tools.git_push_timeout_seconds': 'Git push timeout must be at least 1.',
          'agent.history_preserve_recent':
            'Preserved specialist history must stay within the overall history budget.',
        },
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'runtime_containers',
          title: 'Runtime container defaults',
          configuredCount: 1,
          errorCount: 0,
        }),
        expect.objectContaining({
          key: 'execution_containers',
          title: 'Execution container defaults',
          configuredCount: 1,
          errorCount: 0,
        }),
        expect.objectContaining({
          key: 'capacity_limits',
          title: 'Capacity limits',
          configuredCount: 0,
          errorCount: 0,
        }),
        expect.objectContaining({
          key: 'tool_timeouts',
          title: 'Tool timeouts',
          configuredCount: 1,
          errorCount: 1,
        }),
        expect.objectContaining({
          key: 'agent_context',
          title: 'Agent context handling',
          configuredCount: 2,
          errorCount: 1,
        }),
      ]),
    );
  });
});
