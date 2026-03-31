import { describe, expect, it } from 'vitest';

import {
  buildAssignmentRoleRows,
  formatContextWindow,
  getProviderTypeDefaults,
  reasoningBadgeVariant,
  reasoningLabel,
} from './models-page.js';

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
    expect(defaults.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta');
  });
});

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
