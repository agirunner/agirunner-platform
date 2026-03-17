import { describe, expect, it } from 'vitest';

import {
  fieldsForSection,
  SECTION_DEFINITIONS,
} from './runtime-defaults.schema.js';
import { buildValidationErrors } from './runtime-defaults.validation.js';
import {
  summarizeRuntimeDefaults,
  summarizeRuntimeDefaultSections,
} from './runtime-defaults-page.support.js';

describe('runtime defaults page support', () => {
  it('exposes dedicated runtime sections for agent context, orchestrator overrides, and safeguards', () => {
    expect(SECTION_DEFINITIONS.map((section) => section.key)).toEqual([
      'containers',
      'server_timeouts',
      'llm_transport',
      'tool_timeouts',
      'container_timeouts',
      'lifecycle_timeouts',
      'task_timeouts',
      'connected_platform',
      'workflow_activation',
      'container_manager',
      'worker_supervision',
      'workspace_timeouts',
      'capture_timeouts',
      'secrets_timeouts',
      'subagent_timeouts',
      'agent_context',
      'orchestrator_context',
      'agent_safeguards',
      'fleet',
      'search',
    ]);
    expect(fieldsForSection('tool_timeouts').map((field) => field.key)).toContain(
      'tools.git_push_timeout_seconds',
    );
    expect(fieldsForSection('tool_timeouts').map((field) => field.key)).toContain(
      'tools.shell_exec_timeout_min_seconds',
    );
    expect(fieldsForSection('workspace_timeouts').map((field) => field.key)).toContain(
      'workspace.clone_timeout_seconds',
    );
    expect(fieldsForSection('connected_platform').map((field) => field.key)).toContain(
      'platform.claim_poll_seconds',
    );
    expect(fieldsForSection('workflow_activation').map((field) => field.key)).toContain(
      'platform.workflow_activation_delay_ms',
    );
    expect(fieldsForSection('container_manager').map((field) => field.key)).toContain(
      'container_manager.reconcile_interval_seconds',
    );
    expect(fieldsForSection('worker_supervision').map((field) => field.key)).toContain(
      'platform.worker_dispatch_ack_timeout_ms',
    );
    expect(fieldsForSection('task_timeouts').map((field) => field.key)).toContain(
      'tasks.default_timeout_minutes',
    );
    expect(fieldsForSection('agent_context').map((field) => field.key)).toContain(
      'agent.history_max_messages',
    );
    expect(fieldsForSection('orchestrator_context').map((field) => field.key)).toContain(
      'agent.orchestrator_context_compaction_threshold',
    );
    expect(fieldsForSection('agent_safeguards').map((field) => field.key)).toContain(
      'agent.max_iterations',
    );
  });

  it('validates numeric runtime ranges and history relationships before save', () => {
    const errors = buildValidationErrors({
      'agent.history_max_messages': '20',
      'agent.history_preserve_recent': '25',
      'agent.context_compaction_threshold': '1.5',
      'agent.orchestrator_history_preserve_recent': '21',
      'agent.loop_detection_repeat': '0',
    });

    expect(errors['agent.history_preserve_recent']).toContain('overall history budget');
    expect(errors['agent.context_compaction_threshold']).toContain('at most 1');
    expect(errors['agent.orchestrator_history_preserve_recent']).toContain(
      'overall history budget',
    );
    expect(errors['agent.loop_detection_repeat']).toContain('at least 1');
  });

  it('validates risky container-default overrides with recovery guidance before save', () => {
    const errors = buildValidationErrors({
      default_runtime_image: 'https://ghcr.io/agirunner/agirunner runtime:latest',
      default_cpu: '0',
      default_memory: 'banana',
    });

    expect(errors['default_runtime_image']).toContain('image:tag or image@sha256:digest');
    expect(errors['default_runtime_image']).toContain('clear the field');
    expect(errors['default_cpu']).toContain('greater than 0');
    expect(errors['default_memory']).toContain('512m, 2g, or 2Gi');
  });

  it('validates provider-specific web search requirements before save', () => {
    const errors = buildValidationErrors({
      'tools.web_search_provider': 'serper',
      'tools.web_search_base_url': 'ftp://bad.example.test',
      'tools.web_search_api_key_secret_ref': 'SERPER_API_KEY',
    });

    expect(errors['tools.web_search_base_url']).toContain('valid http or https URL');
    expect(errors['tools.web_search_api_key_secret_ref']).toContain('secret:NAME');

    const missingKeyErrors = buildValidationErrors({
      'tools.web_search_provider': 'tavily',
    });

    expect(missingKeyErrors['tools.web_search_api_key_secret_ref']).toContain(
      'requires a secret reference',
    );
  });

  it('summarizes configured overrides, blockers, and search posture', () => {
    expect(
      summarizeRuntimeDefaults(
        {
          default_runtime_image: 'agirunner-runtime:local',
          'tools.web_search_provider': 'serper',
          'tools.web_search_api_key_secret_ref': 'secret:SERPER_API_KEY',
        },
        {
          global_max_runtimes: 'Global runtime cap must be at least 1.',
        },
      ),
    ).toEqual([
      {
        label: 'Configured overrides',
        value: '3 overrides',
        detail: '3 runtime settings currently override the baked-in platform defaults.',
      },
      {
        label: 'Save blockers',
        value: '1 issue',
        detail: 'Resolve the highlighted validation issues before saving runtime defaults.',
      },
      {
        label: 'Search posture',
        value: 'Serper',
        detail: 'Using provider default endpoint. Secret reference configured.',
      },
    ]);
  });

  it('builds section summaries with configured and error counts', () => {
    expect(
      summarizeRuntimeDefaultSections(
        {
          default_runtime_image: 'agirunner-runtime:local',
          'tools.git_push_timeout_seconds': '90',
          'agent.history_max_messages': '100',
          'agent.history_preserve_recent': '25',
          'tools.web_search_provider': 'serper',
        },
        {
          'tools.git_push_timeout_seconds': 'Git push timeout must be at least 1.',
          'agent.history_preserve_recent': 'Preserve recent specialist messages must stay within the overall history budget.',
        },
      ),
    ).toEqual(
      expect.arrayContaining([
        {
          key: 'containers',
          title: 'Agent container defaults',
          configuredCount: 1,
          fieldCount: 5,
          errorCount: 0,
        },
        {
          key: 'tool_timeouts',
          title: 'Tool timeouts',
          configuredCount: 1,
          fieldCount: 16,
          errorCount: 1,
        },
        {
          key: 'container_manager',
          title: 'Container manager',
          configuredCount: 0,
          fieldCount: 4,
          errorCount: 0,
        },
        {
          key: 'task_timeouts',
          title: 'Task timeouts',
          configuredCount: 0,
          fieldCount: 1,
          errorCount: 0,
        },
        {
          key: 'connected_platform',
          title: 'Connected platform',
          configuredCount: 0,
          fieldCount: 3,
          errorCount: 0,
        },
        {
          key: 'agent_context',
          title: 'Agent context handling',
          configuredCount: 2,
          fieldCount: 4,
          errorCount: 1,
        },
        {
          key: 'search',
          title: 'Web research',
          configuredCount: 1,
          fieldCount: 3,
          errorCount: 0,
        },
      ]),
    );
  });
});
