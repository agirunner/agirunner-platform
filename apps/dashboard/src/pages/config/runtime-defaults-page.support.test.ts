import { describe, expect, it } from 'vitest';

import { fieldsForSection, SECTION_DEFINITIONS } from './runtime-defaults.schema.js';
import { buildValidationErrors } from './runtime-defaults.validation.js';
import {
  summarizeRuntimeDefaults,
  summarizeRuntimeDefaultSections,
} from './runtime-defaults-page.support.js';

describe('runtime defaults page support', () => {
  it('exposes dedicated runtime sections for agent context, orchestrator overrides, and safeguards', () => {
    expect(SECTION_DEFINITIONS.map((section) => section.key)).toEqual([
      'containers',
      'process_logging',
      'server_timeouts',
      'runtime_api',
      'llm_transport',
      'tool_timeouts',
      'container_timeouts',
      'container_reuse',
      'lifecycle_timeouts',
      'task_timeouts',
      'connected_platform',
      'realtime_transport',
      'workflow_activation',
      'container_manager',
      'pool_management',
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
      'fleet',
    ]);
    expect(fieldsForSection('tool_timeouts').map((field) => field.key)).toContain(
      'tools.git_push_timeout_seconds',
    );
    expect(fieldsForSection('process_logging').map((field) => field.key)).toContain('log.level');
    expect(fieldsForSection('runtime_api').map((field) => field.key)).toContain(
      'api.events_heartbeat_seconds',
    );
    expect(fieldsForSection('tool_timeouts').map((field) => field.key)).toContain(
      'tools.shell_exec_timeout_min_seconds',
    );
    expect(fieldsForSection('workspace_timeouts').map((field) => field.key)).toContain(
      'workspace.clone_timeout_seconds',
    );
    expect(fieldsForSection('workspace_operations').map((field) => field.key)).toContain(
      'workspace.clone_max_retries',
    );
    expect(fieldsForSection('workspace_operations').map((field) => field.key)).toContain(
      'workspace.clone_backoff_base_seconds',
    );
    expect(fieldsForSection('workspace_operations').map((field) => field.key)).toContain(
      'workspace.snapshot_interval',
    );
    expect(fieldsForSection('container_reuse').map((field) => field.key)).toContain(
      'container.max_reuse_age_seconds',
    );
    expect(fieldsForSection('container_reuse').map((field) => field.key)).toContain(
      'container.max_reuse_tasks',
    );
    expect(fieldsForSection('connected_platform').map((field) => field.key)).toContain(
      'platform.claim_poll_seconds',
    );
    expect(fieldsForSection('connected_platform').map((field) => field.key)).toContain(
      'platform.api_request_timeout_seconds',
    );
    expect(fieldsForSection('connected_platform').map((field) => field.key)).toContain(
      'platform.log_ingest_timeout_seconds',
    );
    expect(fieldsForSection('connected_platform').map((field) => field.key)).toContain(
      'platform.log_flush_interval_ms',
    );
    expect(fieldsForSection('realtime_transport').map((field) => field.key)).toContain(
      'platform.event_stream_keepalive_interval_ms',
    );
    expect(fieldsForSection('realtime_transport').map((field) => field.key)).toContain(
      'platform.worker_reconnect_min_ms',
    );
    expect(fieldsForSection('realtime_transport').map((field) => field.key)).toContain(
      'platform.worker_reconnect_max_ms',
    );
    expect(fieldsForSection('realtime_transport').map((field) => field.key)).toContain(
      'platform.worker_websocket_ping_interval_ms',
    );
    expect(fieldsForSection('workflow_activation').map((field) => field.key)).toContain(
      'platform.workflow_activation_delay_ms',
    );
    expect(fieldsForSection('container_manager').map((field) => field.key)).toContain(
      'container_manager.reconcile_interval_seconds',
    );
    expect(fieldsForSection('container_manager').map((field) => field.key)).toContain(
      'container_manager.hung_runtime_stale_after_seconds',
    );
    expect(fieldsForSection('container_manager').map((field) => field.key)).toContain(
      'container_manager.hung_runtime_stop_grace_period_seconds',
    );
    expect(fieldsForSection('container_manager').map((field) => field.key)).toContain(
      'container_manager.log_flush_interval_ms',
    );
    expect(fieldsForSection('container_manager').map((field) => field.key)).toContain(
      'container_manager.docker_event_reconnect_backoff_ms',
    );
    expect(fieldsForSection('container_manager').map((field) => field.key)).toContain(
      'container_manager.crash_log_capture_timeout_seconds',
    );
    expect(fieldsForSection('container_manager').map((field) => field.key)).toContain(
      'container_manager.starvation_threshold_seconds',
    );
    expect(fieldsForSection('container_manager').map((field) => field.key)).toContain(
      'container_manager.runtime_orphan_grace_cycles',
    );
    expect(fieldsForSection('pool_management').map((field) => field.key)).toContain(
      'pool.refresh_interval_seconds',
    );
    expect(fieldsForSection('worker_supervision').map((field) => field.key)).toContain(
      'platform.worker_dispatch_ack_timeout_ms',
    );
    expect(fieldsForSection('worker_supervision').map((field) => field.key)).toContain(
      'platform.worker_key_expiry_ms',
    );
    expect(fieldsForSection('agent_supervision').map((field) => field.key)).toContain(
      'platform.agent_heartbeat_threshold_multiplier',
    );
    expect(fieldsForSection('webhook_delivery').map((field) => field.key)).toContain(
      'platform.webhook_max_attempts',
    );
    expect(fieldsForSection('webhook_delivery').map((field) => field.key)).toContain(
      'platform.webhook_retry_base_delay_ms',
    );
    expect(fieldsForSection('platform_loops').map((field) => field.key)).toContain(
      'platform.lifecycle_dispatch_loop_interval_ms',
    );
    expect(fieldsForSection('task_timeouts').map((field) => field.key)).toContain(
      'tasks.default_timeout_minutes',
    );
    expect(fieldsForSection('agent_context').map((field) => field.key)).toContain(
      'agent.history_max_messages',
    );
    expect(fieldsForSection('agent_context').map((field) => field.key)).toContain(
      'agent.specialist_context_strategy',
    );
    expect(fieldsForSection('agent_context').map((field) => field.key)).toContain(
      'agent.specialist_prepare_for_compaction_enabled',
    );
    expect(fieldsForSection('orchestrator_context').map((field) => field.key)).toContain(
      'agent.orchestrator_context_compaction_threshold',
    );
    expect(fieldsForSection('orchestrator_context').map((field) => field.key)).toContain(
      'agent.orchestrator_context_strategy',
    );
    expect(fieldsForSection('orchestrator_context').map((field) => field.key)).toContain(
      'agent.orchestrator_finish_checkpoint_enabled',
    );
    expect(fieldsForSection('agent_safeguards').map((field) => field.key)).toContain(
      'agent.max_iterations',
    );
  });

  it('validates numeric runtime ranges and history relationships before save', () => {
    const errors = buildValidationErrors({
      'agent.history_max_messages': '20',
      'agent.history_preserve_recent': '25',
      'agent.specialist_context_tail_messages': '21',
      'agent.context_compaction_threshold': '1.5',
      'agent.specialist_context_strategy': 'invalid',
      'agent.orchestrator_history_preserve_recent': '21',
      'agent.loop_detection_repeat': '0',
    });

    expect(errors['agent.history_preserve_recent']).toContain('overall history budget');
    expect(errors['agent.specialist_context_tail_messages']).toContain('overall history budget');
    expect(errors['agent.context_compaction_threshold']).toContain('at most 1');
    expect(errors['agent.specialist_context_strategy']).toContain('must be one of');
    expect(errors['agent.orchestrator_history_preserve_recent']).toContain(
      'overall history budget',
    );
    expect(errors['agent.loop_detection_repeat']).toContain('at least 1');
  });

  it('rejects worker reconnect ranges where the minimum exceeds the maximum', () => {
    const errors = buildValidationErrors({
      'platform.worker_reconnect_min_ms': '60000',
      'platform.worker_reconnect_max_ms': '1000',
    });

    expect(errors['platform.worker_reconnect_max_ms']).toContain('at least the minimum');
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

  it('summarizes configured overrides and blockers', () => {
    expect(
      summarizeRuntimeDefaults(
        {
          default_runtime_image: 'agirunner-runtime:local',
          'tools.web_fetch_timeout_seconds': '45',
        },
        {
          global_max_runtimes: 'Global runtime cap must be at least 1.',
        },
      ),
    ).toEqual([
      {
        label: 'Configured overrides',
        value: '2 overrides',
        detail: '2 runtime settings currently override the baked-in platform defaults.',
      },
      {
        label: 'Save blockers',
        value: '1 issue',
        detail: 'Resolve the highlighted validation issues before saving runtime defaults.',
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
        },
        {
          'tools.git_push_timeout_seconds': 'Git push timeout must be at least 1.',
          'agent.history_preserve_recent':
            'Preserve recent specialist messages must stay within the overall history budget.',
        },
      ),
    ).toEqual(
      expect.arrayContaining([
        {
          key: 'containers',
          title: 'Agent container defaults',
          configuredCount: 1,
          fieldCount: 6,
          errorCount: 0,
        },
        {
          key: 'process_logging',
          title: 'Process logging',
          configuredCount: 0,
          fieldCount: 1,
          errorCount: 0,
        },
        {
          key: 'runtime_api',
          title: 'Runtime API',
          configuredCount: 0,
          fieldCount: 1,
          errorCount: 0,
        },
        {
          key: 'tool_timeouts',
          title: 'Tool timeouts',
          configuredCount: 1,
          fieldCount: 15,
          errorCount: 1,
        },
        {
          key: 'container_reuse',
          title: 'Container reuse',
          configuredCount: 0,
          fieldCount: 2,
          errorCount: 0,
        },
        {
          key: 'container_manager',
          title: 'Container manager',
          configuredCount: 0,
          fieldCount: 11,
          errorCount: 0,
        },
        {
          key: 'pool_management',
          title: 'Pool refresh',
          configuredCount: 0,
          fieldCount: 1,
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
          fieldCount: 8,
          errorCount: 0,
        },
        {
          key: 'agent_context',
          title: 'Agent context handling',
          configuredCount: 2,
          fieldCount: 11,
          errorCount: 1,
        },
        {
          key: 'orchestrator_context',
          title: 'Orchestrator context overrides',
          configuredCount: 0,
          fieldCount: 8,
          errorCount: 0,
        },
        {
          key: 'workspace_operations',
          title: 'Workspace operations',
          configuredCount: 0,
          fieldCount: 3,
          errorCount: 0,
        },
      ]),
    );
  });
});
