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
  });

  it('renders the Model Catalog section with endpoint column', () => {
    expect(source).toContain('Model Catalog');
    expect(source).toContain('formatContextWindow');
    expect(source).toContain('endpoint_type');
  });

  it('renders the Role Model Assignments section', () => {
    expect(source).toContain('Role Model Assignments');
    expect(source).toContain('RoleAssignmentRow');
    expect(source).toContain('ROLE_NAMES');
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
