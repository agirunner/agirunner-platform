import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { FIELD_DEFINITIONS, SECTION_DEFINITIONS } from './runtime-defaults.schema.js';

function readSource(fileName: string) {
  return readFileSync(resolve(import.meta.dirname, fileName), 'utf8');
}

describe('runtime defaults page source', () => {
  it('exposes the supported runtime configuration sections and agent fields through structured schema exports', () => {
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
      'workflow_activation',
      'container_manager',
      'pool_management',
      'worker_supervision',
      'agent_supervision',
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
      'search',
    ]);
    expect(FIELD_DEFINITIONS.map((field) => field.key)).toEqual(
      expect.arrayContaining([
        'default_runtime_image',
        'default_pull_policy',
        'log.level',
        'server.shutdown_timeout_seconds',
        'api.events_heartbeat_seconds',
        'llm.http_timeout_seconds',
        'tools.git_push_timeout_seconds',
        'tools.shell_exec_timeout_min_seconds',
        'tools.shell_exec_timeout_max_seconds',
        'lifecycle.healthcheck_retry_delay_seconds',
        'tasks.default_timeout_minutes',
        'platform.claim_poll_seconds',
        'platform.api_request_timeout_seconds',
        'platform.log_ingest_timeout_seconds',
        'platform.log_flush_interval_ms',
        'platform.cancellation_report_timeout_seconds',
        'platform.self_terminate_cleanup_timeout_seconds',
        'container.max_reuse_age_seconds',
        'container.max_reuse_tasks',
        'platform.heartbeat_max_failures',
        'platform.drain_timeout_seconds',
        'platform.workflow_activation_delay_ms',
        'platform.task_cancel_signal_grace_period_ms',
        'container_manager.reconcile_interval_seconds',
        'container_manager.hung_runtime_stale_after_seconds',
        'container_manager.hung_runtime_stop_grace_period_seconds',
        'container_manager.log_flush_interval_ms',
        'container_manager.docker_event_reconnect_backoff_ms',
        'container_manager.crash_log_capture_timeout_seconds',
        'container_manager.starvation_threshold_seconds',
        'container_manager.runtime_orphan_grace_cycles',
        'pool.refresh_interval_seconds',
        'platform.worker_dispatch_ack_timeout_ms',
        'platform.worker_key_expiry_ms',
        'platform.agent_heartbeat_threshold_multiplier',
        'platform.worker_offline_threshold_multiplier',
        'platform.lifecycle_dispatch_loop_interval_ms',
        'platform.heartbeat_prune_interval_ms',
        'workspace.clone_timeout_seconds',
        'workspace.clone_max_retries',
        'workspace.clone_backoff_base_seconds',
        'workspace.snapshot_interval',
        'capture.push_timeout_seconds',
        'secrets.vault_timeout_seconds',
        'subagent.default_timeout_seconds',
        'agent.history_max_messages',
        'agent.context_compaction_threshold',
        'agent.orchestrator_context_compaction_threshold',
        'agent.max_iterations',
        'agent.llm_max_retries',
        'tools.web_search_provider',
      ]),
    );
  });

  it('composes the page from schema, validation, shared fields, and runtime status cards', () => {
    const source = readSource('./runtime-defaults-page.tsx');
    expect(source).toContain('RuntimeDefaultsSection');
    expect(source).toContain('SECTION_DEFINITIONS.map');
    expect(source).toContain('buildValidationErrors');
    expect(source).toContain('summarizeRuntimeDefaults');
    expect(source).toContain('summarizeRuntimeDefaultSections');
    expect(source).toContain('Save readiness');
    expect(source).toContain('Section outline');
    expect(source).toContain('runtime-defaults-');
    expect(source).toContain('ActiveRuntimeImageCard');
    expect(source).toContain('BuildHistoryCard');
    expect(source).not.toContain('JSON.parse');
  });

  it('guards against unsaved changes via beforeunload', () => {
    const source = readSource('./runtime-defaults-page.tsx');
    expect(source).toContain('useUnsavedChanges');
    expect(source).toContain('useUnsavedChanges(isDirty)');
  });

  it('renders web search provider controls through a dedicated first-class section instead of generic rows', () => {
    const source = readSource('./runtime-defaults-fields.tsx');
    expect(source).toContain('RuntimeDefaultsSearchSection');
    expect(source).toContain("fields[0]?.section === 'search'");
    expect(source).toContain('ConfigField');
  });

  it('routes web search fields through the shared config control primitives with field-level support text', () => {
    const source = readSource('./runtime-defaults-search.tsx');
    expect(source).toContain('ConfigSelectField');
    expect(source).toContain('ConfigInputField');
    expect(source).toContain('buildWebSearchFieldSupport');
    expect(source).not.toContain('function SearchFieldBlock');
  });

  it('uses the shared dashboard API client for runtime-defaults CRUD', () => {
    const source = readSource('./runtime-defaults.api.ts');
    expect(source).toContain('dashboardApi.listRuntimeDefaults');
    expect(source).toContain('dashboardApi.upsertRuntimeDefault');
    expect(source).toContain('dashboardApi.deleteRuntimeDefault');
    expect(source).not.toContain('getAuthHeaders');
  });
});
