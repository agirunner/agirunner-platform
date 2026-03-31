import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { FIELD_DEFINITIONS, SECTION_DEFINITIONS } from './runtime-defaults.schema.js';

function readSource(fileName: string) {
  return readFileSync(resolve(import.meta.dirname, fileName), 'utf8');
}

function readApiContractSource() {
  return [
    '../../lib/api.ts',
    '../../lib/dashboard-api/contracts.ts',
  ]
    .map((fileName) => readSource(fileName))
    .join('\n');
}

describe('runtime defaults page source', () => {
  it('exposes the specialist runtime schema through structured exports', () => {
    expect(SECTION_DEFINITIONS.map((section) => section.key)).toEqual([
      'runtime_containers',
      'task_limits',
      'server_timeouts',
      'tool_timeouts',
      'lifecycle_timeouts',
      'connected_platform',
      'workspace_timeouts',
      'capture_timeouts',
      'secrets_timeouts',
      'subagent_timeouts',
      'agent_context',
      'orchestrator_context',
      'agent_safeguards',
    ]);

    expect(
      SECTION_DEFINITIONS.find((section) => section.key === 'runtime_containers')?.description,
    ).toBe(
      'Default image and resource limits for short-lived specialist agents that host the agent loop. This image is different from the environment where your specialists execute their tasks. This small alpine-based image is optimized for running the agentic loop, not for executing complex tasks.',
    );

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
    expect(pageSource).toContain('navHref="/admin/agentic-settings"');
    expect(pageSource).toContain('successMessage="Agentic Settings saved."');
    expect(pageSource).toContain('headerDescriptionClassName="max-w-none whitespace-nowrap"');
    expect(pageSource).toContain('dashboardApi.getAgenticSettings()');
    expect(pageSource).toContain('dashboardApi.updateAgenticSettings');
    expect(pageSource).toContain('fieldId="agentic-live-visibility-mode"');
    expect(pageSource).toContain('label="Live visibility mode"');
    expect(pageSource).toContain('fieldId="agentic-prompt-warning-threshold"');
    expect(pageSource).toContain('label="Prompt warning threshold"');
    expect(pageSource).toContain('prompt_warning_threshold_chars');
    expect(pageSource).toContain(
      'additionalHasValidationErrors={Boolean(promptWarningThresholdError)}',
    );
    expect(pageSource).toContain('connected_platform: (');
    expect(pageSource).toContain('PRIMARY_RUNTIME_DEFAULT_SECTION_KEYS');
    expect(pageSource).toContain('RUNTIME_INLINE_SECTION_COLUMNS');
    expect(editorSource).toContain('RuntimeDefaultsSection');
    expect(editorSource).toContain('DashboardPageHeader');
    expect(editorSource).toContain('navHref={props.navHref}');
    expect(editorSource).toContain('descriptionClassName={props.headerDescriptionClassName}');
    expect(editorSource).toContain('inlineSectionColumns');
    expect(editorSource).toContain('grid gap-6 xl:grid-cols-2');
    expect(editorSource).not.toContain('renderPrimaryAsideCard');
    expect(editorSource).not.toContain('Configuration status');
    expect(editorSource).not.toContain('RuntimeAdvancedSettingsSection');
    expect(editorSource).toContain('Reset changes');
    expect(editorSource).toContain('Save');
    expect(editorSource).toContain(
      "sectionSupplementalContent?: Partial<Record<SectionDefinition['key'], ReactNode>>;",
    );
    expect(editorSource).toContain('additionalHasChanges?: boolean;');
    expect(editorSource).toContain('onSaveAdditional?(): Promise<void>;');
    expect(editorSource).toContain(
      'supplementalContent={props.sectionSupplementalContent?.[section.key]}',
    );
    expect(editorSource).toContain('buildValidationErrors');
    expect(editorSource).toContain('summarizeRuntimeDefaultSections');
    expect(editorSource).toContain('className="space-y-6 p-6"');
    expect(editorSource).not.toContain(
      '<Card>\n        <CardHeader>\n          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">',
    );
    expect(editorSource).toContain('const leftColumnSections = useMemo');
    expect(editorSource).toContain('const rightColumnSections = useMemo');
    expect(editorSource).toContain(
      'rightColumnSections.map((section) => renderSectionCard(section))',
    );
    expect(pageSource).not.toContain('sticky bottom-4');
    expect(pageSource).not.toContain('Save runtime defaults');
    expect(pageSource).not.toContain('ActiveRuntimeImageCard');
    expect(pageSource).not.toContain('BuildHistoryCard');
    expect(pageSource).not.toContain('RuntimeManagementCard');
    expect(pageSource).not.toContain('Save readiness');
    expect(pageSource).not.toContain('Configured overrides');
    expect(pageSource).not.toContain('Save blockers');
    expect(pageSource).not.toContain('Warm pools');
    expect(pageSource).not.toContain('Save live visibility');
    expect(fieldsSource).not.toContain('Advanced Settings');
    expect(fieldsSource).not.toContain('Runtime log level');
    expect(fieldsSource).not.toContain('Show');
    expect(fieldsSource).not.toContain('Hide');
  });

  it('guards against unsaved changes via beforeunload', () => {
    const source = readSource('./runtime-defaults-editor-page.tsx');
    expect(source).toContain('useUnsavedChanges');
    expect(source).toContain(
      'const hasAnyChanges = isDirty || Boolean(props.additionalHasChanges);',
    );
    expect(source).toContain('useUnsavedChanges(hasAnyChanges)');
  });

  it('keeps all hooks before the loading and error early returns', () => {
    const source = readSource('./runtime-defaults-editor-page.tsx');
    const loadingIndex = source.indexOf('if (isLoading)');
    const errorIndex = source.indexOf('if (error)');
    const sectionSummaryByKeyIndex = source.indexOf('const sectionSummaryByKey = useMemo');

    expect(loadingIndex).toBeGreaterThan(-1);
    expect(errorIndex).toBeGreaterThan(loadingIndex);
    expect(sectionSummaryByKeyIndex).toBeGreaterThan(-1);
    expect(sectionSummaryByKeyIndex).toBeLessThan(loadingIndex);
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

  it('types tenant agentic settings with the prompt warning threshold contract', () => {
    const source = readApiContractSource();

    expect(source).toContain('prompt_warning_threshold_chars: number;');
    expect(source).toContain('settings_revision: number;');
  });
});
