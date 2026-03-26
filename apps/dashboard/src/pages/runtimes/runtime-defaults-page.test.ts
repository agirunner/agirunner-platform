import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { FIELD_DEFINITIONS, SECTION_DEFINITIONS } from './runtime-defaults.schema.js';

function readSource(fileName: string) {
  return readFileSync(resolve(import.meta.dirname, fileName), 'utf8');
}

describe('runtime defaults page source', () => {
  it('exposes the specialist runtime schema through structured exports', () => {
    expect(SECTION_DEFINITIONS.map((section) => section.key)).toEqual([
      'runtime_containers',
      'task_limits',
      'capacity_limits',
      'runtime_throughput',
      'server_timeouts',
      'runtime_api',
      'llm_transport',
      'tool_timeouts',
      'lifecycle_timeouts',
      'connected_platform',
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
        'global_max_specialists',
        'specialist_runtime_bootstrap_claim_timeout_seconds',
        'queue.max_depth',
        'platform.claim_poll_seconds',
        'agent.max_iterations',
        'agent.llm_max_retries',
        'agent.max_tool_steps_per_burst',
        'agent.max_mutating_steps_per_burst',
        'agent.max_burst_elapsed_ms',
        'agent.max_parallel_tool_calls_per_burst',
      ]),
    );

    expect(FIELD_DEFINITIONS.map((field) => field.key)).not.toEqual(
      expect.arrayContaining(['log.level']),
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
        'tasks.default_timeout_minutes',
        'specialist_runtime_drain_grace_seconds',
        'platform.workflow_activation_delay_ms',
        'container_manager.reconcile_interval_seconds',
        'docker.checker_timeout_ms',
        'platform.webhook_max_attempts',
      ]),
    );
  });

  it('reuses the shared defaults editor and keeps the same advanced settings container', () => {
    const pageSource = readSource('./runtime-defaults-page.tsx');
    const editorSource = readSource('./runtime-defaults-editor-page.tsx');
    const fieldsSource = readSource('./runtime-defaults-fields.tsx');
    expect(pageSource).toContain('RuntimeDefaultsEditorPage');
    expect(pageSource).toContain('title="Specialist Agents"');
    expect(pageSource).toContain('PRIMARY_RUNTIME_DEFAULT_SECTION_KEYS');
    expect(pageSource).toContain('RUNTIME_INLINE_SECTION_COLUMNS');
    expect(editorSource).toContain('RuntimeDefaultsSection');
    expect(editorSource).toContain('inlineSectionColumns');
    expect(editorSource).not.toContain('RuntimeAdvancedSettingsSection');
    expect(editorSource).toContain('Reset changes');
    expect(editorSource).toContain('Save');
    expect(editorSource).toContain('buildValidationErrors');
    expect(editorSource).toContain('summarizeRuntimeDefaultSections');
    expect(editorSource).toContain('className="space-y-6 p-6"');
    expect(pageSource).not.toContain('sticky bottom-4');
    expect(pageSource).not.toContain('Save runtime defaults');
    expect(pageSource).not.toContain('ActiveRuntimeImageCard');
    expect(pageSource).not.toContain('BuildHistoryCard');
    expect(pageSource).not.toContain('RuntimeManagementCard');
    expect(pageSource).not.toContain('Save readiness');
    expect(pageSource).not.toContain('Configured overrides');
    expect(pageSource).not.toContain('Save blockers');
    expect(pageSource).not.toContain('Warm pools');
    expect(fieldsSource).not.toContain('Advanced Settings');
    expect(fieldsSource).not.toContain('Runtime log level');
    expect(fieldsSource).not.toContain('Show');
    expect(fieldsSource).not.toContain('Hide');
  });

  it('guards against unsaved changes via beforeunload', () => {
    const source = readSource('./runtime-defaults-editor-page.tsx');
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
    expect(source).not.toContain('dashboardApi.deleteRuntimeDefault');
    expect(source).not.toContain('getAuthHeaders');
  });
});
