/**
 * Structural and unit tests for the LLM Providers page.
 *
 * Tests cover:
 *  - Page renders the three sections (Providers, Model Catalog, Role Assignments)
 *  - Provider type auto-fill mapping function
 *  - Context window formatting function
 *  - Reasoning config badge and label helpers
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  buildAssignmentRoleRows,
  formatContextWindow,
  reasoningLabel,
  reasoningBadgeVariant,
  getProviderTypeDefaults,
} from './llm-providers-page.js';

const dashboardSrc = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

function readComponent(relPath: string): string {
  return fs.readFileSync(path.join(dashboardSrc, relPath), 'utf-8');
}

/* ─── Structural: three sections ────────────────────────────────────────── */

describe('LlmProvidersPage renders three sections', () => {
  const source = readComponent('pages/config/llm-providers-page.tsx');

  it('renders the Providers section with heading and Add Provider button', () => {
    expect(source).toContain('LLM Providers');
    expect(source).toContain('Add Provider');
    expect(source).toContain('ProviderCard');
    expect(source).toContain('max-h-[85vh] max-w-2xl overflow-y-auto');
  });

  it('uses a confirmed destructive flow for provider deletion and labeled responsive actions', () => {
    expect(source).toContain('DeleteProviderDialog');
    expect(source).toContain('Delete provider?');
    expect(source).toContain('Delete Provider');
    expect(source).toContain('variant="destructive"');
    expect(source).toContain('requestProviderDelete');
    expect(source).toContain('sm:flex-row sm:flex-wrap sm:justify-end');
    expect(source).not.toContain('onDelete={(id) => deleteMutation.mutate(id)}');
  });

  it('treats provider api keys as write-only', () => {
    expect(source).toContain('Stored write-only. Existing keys are never shown again.');
    expect(source).toContain('credentials_configured');
  });

  it('renders the Model Catalog section with endpoint column', () => {
    expect(source).toContain('Model Catalog');
    expect(source).toContain('formatContextWindow');
    expect(source).toContain('endpoint_type');
  });

  it('renders the Model Assignments section', () => {
    expect(source).toContain('Model Assignments');
    expect(source).toContain('RoleAssignmentsSection');
    expect(source).toContain('fetchRoleDefinitions');
    expect(source).toContain('buildAssignmentRoleRows');
    expect(source).toContain('Orchestrator and Role Overrides');
    expect(source).toContain('1 orchestrator row');
    expect(source).not.toContain('const ROLE_NAMES');
  });

  it('renders dynamic ReasoningControl based on model schema', () => {
    expect(source).toContain('ReasoningControl');
    expect(source).toContain('reasoning_config');
    expect(source).toContain('buildReasoningValue');
  });
});

/* ─── Provider type auto-fill mapping ───────────────────────────────────── */

describe('getProviderTypeDefaults auto-fill mapping', () => {
  it('returns correct defaults for openai', () => {
    const defaults = getProviderTypeDefaults('openai');
    expect(defaults.name).toBe('OpenAI');
    expect(defaults.baseUrl).toBe('https://api.openai.com/v1');
  });

  it('returns correct defaults for anthropic', () => {
    const defaults = getProviderTypeDefaults('anthropic');
    expect(defaults.name).toBe('Anthropic');
    expect(defaults.baseUrl).toBe('https://api.anthropic.com/v1');
  });

  it('returns correct defaults for google', () => {
    const defaults = getProviderTypeDefaults('google');
    expect(defaults.name).toBe('Google');
    expect(defaults.baseUrl).toBe(
      'https://generativelanguage.googleapis.com/v1beta',
    );
  });
});

/* ─── Context window formatting ─────────────────────────────────────────── */

describe('formatContextWindow', () => {
  it('formats undefined as dash', () => {
    expect(formatContextWindow(undefined)).toBe('-');
  });

  it('formats small numbers as-is', () => {
    expect(formatContextWindow(512)).toBe('512');
  });

  it('formats thousands as K', () => {
    expect(formatContextWindow(200000)).toBe('200K');
  });

  it('formats non-round thousands with decimal', () => {
    expect(formatContextWindow(128500)).toBe('128.5K');
  });

  it('formats millions as M', () => {
    expect(formatContextWindow(1000000)).toBe('1M');
  });

  it('formats 1048576 as M with decimal', () => {
    expect(formatContextWindow(1048576)).toBe('1.0M');
  });

  it('formats 2000000 as 2M', () => {
    expect(formatContextWindow(2000000)).toBe('2M');
  });
});

/* ─── Reasoning config helpers ─────────────────────────────────────────── */

describe('reasoningLabel', () => {
  it('returns none for null config', () => {
    expect(reasoningLabel(null)).toBe('none');
  });

  it('returns none for undefined config', () => {
    expect(reasoningLabel(undefined)).toBe('none');
  });

  it('returns label with type and default for discrete options', () => {
    const config = { type: 'effort' as const, options: ['low', 'medium', 'high'], default: 'high' };
    expect(reasoningLabel(config)).toContain('effort');
    expect(reasoningLabel(config)).toContain('high');
  });

  it('returns label with type and default for numeric config', () => {
    const config = { type: 'thinking_budget' as const, min: 0, max: 24576, default: 0 };
    expect(reasoningLabel(config)).toContain('thinking_budget');
  });
});

describe('reasoningBadgeVariant', () => {
  it('returns secondary for null config', () => {
    expect(reasoningBadgeVariant(null)).toBe('secondary');
  });

  it('returns secondary for undefined config', () => {
    expect(reasoningBadgeVariant(undefined)).toBe('secondary');
  });

  it('returns default for models with reasoning support', () => {
    const config = { type: 'effort' as const, options: ['low', 'medium', 'high'], default: 'high' };
    expect(reasoningBadgeVariant(config)).toBe('default');
  });
});

describe('buildAssignmentRoleRows', () => {
  it('always includes the orchestrator row first so orchestrator model selection is explicit', () => {
    const rows = buildAssignmentRoleRows([], []);

    expect(rows[0]).toEqual({
      name: 'orchestrator',
      description:
        'Workflow orchestrator model used for activation planning, delegation, review, and recovery.',
      isActive: true,
      source: 'system',
    });
  });

  it('prefers active catalog roles and sorts them alphabetically', () => {
    const rows = buildAssignmentRoleRows(
      [
        { id: '2', name: 'reviewer', description: 'Reviews output', is_active: true },
        { id: '1', name: 'architect', description: 'Shapes the system', is_active: true },
      ],
      [],
    );

    expect(rows).toEqual([
      {
        name: 'orchestrator',
        description:
          'Workflow orchestrator model used for activation planning, delegation, review, and recovery.',
        isActive: true,
        source: 'system',
      },
      {
        name: 'architect',
        description: 'Shapes the system',
        isActive: true,
        source: 'catalog',
      },
      {
        name: 'reviewer',
        description: 'Reviews output',
        isActive: true,
        source: 'catalog',
      },
    ]);
  });

  it('keeps stale assignment rows visible after active catalog roles', () => {
    const rows = buildAssignmentRoleRows(
      [
        { id: '1', name: 'developer', description: 'Builds features', is_active: true },
        { id: '2', name: 'qa', description: 'Validates releases', is_active: false },
      ],
      [
        { role_name: 'developer', primary_model_id: 'model-1' },
        { role_name: 'qa', primary_model_id: 'model-2' },
        { role_name: 'orchestrator', primary_model_id: 'model-3' },
      ],
    );

    expect(rows).toEqual([
      {
        name: 'orchestrator',
        description:
          'Workflow orchestrator model used for activation planning, delegation, review, and recovery.',
        isActive: true,
        source: 'system',
      },
      {
        name: 'developer',
        description: 'Builds features',
        isActive: true,
        source: 'catalog',
      },
      {
        name: 'qa',
        description: 'Validates releases',
        isActive: false,
        source: 'catalog',
      },
    ]);
  });
});
