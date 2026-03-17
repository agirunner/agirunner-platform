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
    expect(FIELD_DEFINITIONS.map((field) => field.key)).toEqual(
      expect.arrayContaining([
        'default_runtime_image',
        'default_pull_policy',
        'server.shutdown_timeout_seconds',
        'llm.http_timeout_seconds',
        'tools.git_push_timeout_seconds',
        'tools.shell_exec_timeout_min_seconds',
        'tools.shell_exec_timeout_max_seconds',
        'lifecycle.healthcheck_retry_delay_seconds',
        'tasks.default_timeout_minutes',
        'platform.claim_poll_seconds',
        'platform.heartbeat_max_failures',
        'platform.drain_timeout_seconds',
        'platform.workflow_activation_delay_ms',
        'platform.task_cancel_signal_grace_period_ms',
        'container_manager.reconcile_interval_seconds',
        'platform.worker_dispatch_ack_timeout_ms',
        'platform.worker_offline_threshold_multiplier',
        'workspace.clone_timeout_seconds',
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
