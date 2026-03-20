import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { FIELD_DEFINITIONS, SECTION_DEFINITIONS } from './runtime-defaults.schema.js';

function readSource(fileName: string) {
  return readFileSync(resolve(import.meta.dirname, fileName), 'utf8');
}

describe('runtime defaults page source', () => {
  it('exposes the three-container runtime schema through structured exports', () => {
    expect(SECTION_DEFINITIONS.map((section) => section.key)).toEqual([
      'runtime_containers',
      'execution_containers',
      'task_limits',
      'capacity_limits',
      'runtime_throughput',
      'process_logging',
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

    expect(FIELD_DEFINITIONS.map((field) => field.key)).toEqual(
      expect.arrayContaining([
        'specialist_runtime_default_image',
        'specialist_runtime_default_cpu',
        'specialist_runtime_default_memory',
        'specialist_runtime_default_pull_policy',
        'specialist_execution_default_image',
        'specialist_execution_default_cpu',
        'specialist_execution_default_memory',
        'specialist_execution_default_pull_policy',
        'global_max_runtimes',
        'global_max_execution_containers',
        'specialist_runtime_bootstrap_claim_timeout_seconds',
        'specialist_runtime_drain_grace_seconds',
        'queue.max_concurrency',
        'queue.max_depth',
        'platform.claim_poll_seconds',
        'platform.drain_timeout_seconds',
        'agent.max_iterations',
        'agent.llm_max_retries',
        'agent.max_tool_steps_per_burst',
        'agent.max_mutating_steps_per_burst',
        'agent.max_burst_elapsed_ms',
        'agent.max_parallel_tool_calls_per_burst',
      ]),
    );

    expect(FIELD_DEFINITIONS.map((field) => field.key)).not.toEqual(
      expect.arrayContaining([
        'default_runtime_image',
        'default_cpu',
        'default_memory',
        'default_pull_policy',
        'default_idle_timeout_seconds',
        'default_grace_period',
        'pool.enabled',
        'pool.pool_size',
        'pool.default_image',
        'pool.refresh_interval_seconds',
        'container.max_reuse_age_seconds',
        'container.max_reuse_tasks',
        'tools.web_search_provider',
        'tools.web_search_base_url',
        'tools.web_search_api_key_secret_ref',
      ]),
    );
  });

  it('composes the page from schema, validation, shared fields, and runtime status cards', () => {
    const source = readSource('./runtime-defaults-page.tsx');
    expect(source).toContain('RuntimeDefaultsSection');
    expect(source).toContain('SECTION_DEFINITIONS.map');
    expect(source).toContain('expandedSections');
    expect(source).toContain('buildValidationErrors');
    expect(source).toContain('summarizeRuntimeDefaultSections');
    expect(source).toContain('sticky bottom-4');
    expect(source).toContain('Save runtime defaults');
    expect(source).toContain('New specialist runtimes and execution containers pick up updated defaults as they start.');
    expect(source).toContain('className="space-y-6 p-6"');
    expect(source).toContain('runtime-defaults-');
    expect(source).toContain('ActiveRuntimeImageCard');
    expect(source).toContain('BuildHistoryCard');
    expect(source).toContain('RuntimeManagementCard');
    expect(source).not.toContain('Save readiness');
    expect(source).not.toContain('Configured overrides');
    expect(source).not.toContain('Save blockers');
    expect(source).not.toContain('Warm pools');
  });

  it('guards against unsaved changes via beforeunload', () => {
    const source = readSource('./runtime-defaults-page.tsx');
    expect(source).toContain('useUnsavedChanges');
    expect(source).toContain('useUnsavedChanges(isDirty)');
  });

  it('renders runtime defaults sections exclusively through shared config field primitives', () => {
    const source = readSource('./runtime-defaults-fields.tsx');
    expect(source).toContain('ConfigField');
    expect(source).not.toContain('RuntimeDefaultsSearchSection');
  });

  it('uses the shared dashboard API client for runtime-defaults CRUD', () => {
    const source = readSource('./runtime-defaults.api.ts');
    expect(source).toContain('dashboardApi.listRuntimeDefaults');
    expect(source).toContain('dashboardApi.upsertRuntimeDefault');
    expect(source).toContain('dashboardApi.deleteRuntimeDefault');
    expect(source).not.toContain('getAuthHeaders');
  });
});
