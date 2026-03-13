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

  it('renders web search provider controls through a dedicated first-class section instead of generic rows', () => {
    const source = readSource('./runtime-defaults-fields.tsx');
    expect(source).toContain('RuntimeDefaultsSearchSection');
    expect(source).toContain("fields[0]?.section === 'search'");
    expect(source).toContain('ConfigField');
  });

  it('uses the supported runtime-defaults API routes, including delete for clearing values', () => {
    const source = readSource('./runtime-defaults.api.ts');
    expect(source).toContain('/api/v1/config/runtime-defaults');
    expect(source).toContain("method: 'POST'");
    expect(source).toContain("method: 'DELETE'");
    expect(source).not.toContain("method: 'PATCH'");
  });
});
