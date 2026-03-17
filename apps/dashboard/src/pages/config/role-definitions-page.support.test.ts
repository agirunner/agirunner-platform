import { describe, expect, it } from 'vitest';

import {
  buildRoleModelOptions,
  buildRolePayload,
  createDuplicateRoleForm,
  listAvailableCapabilities,
} from './role-definitions-page.support.js';

describe('role definitions support helpers', () => {
  it('includes allowed tools and active state in the save payload', () => {
    expect(
      buildRolePayload({
        name: ' architect ',
        description: ' designs systems ',
        systemPrompt: ' think deeply ',
        allowedTools: ['git_diff', 'git_diff', ' file_read '],
        capabilities: ['architecture', ' architecture ', 'research'],
        isActive: false,
      }),
    ).toEqual({
      name: 'architect',
      description: 'designs systems',
      systemPrompt: 'think deeply',
      allowedTools: ['git_diff', 'file_read'],
      capabilities: ['architecture', 'research'],
      isActive: false,
    });
  });

  it('creates a duplicate form that clears the name and preserves all other role fields', () => {
    const form = createDuplicateRoleForm({
      id: 'role-1',
      name: 'architect',
      description: 'System design specialist',
      system_prompt: 'Think about architecture deeply.',
      allowed_tools: ['file_read', 'git_diff'],
      capabilities: ['architecture', 'documentation'],
      is_built_in: true,
      is_active: false,
    });

    expect(form.name).toBe('');
    expect(form.description).toBe('System design specialist');
    expect(form.systemPrompt).toBe('Think about architecture deeply.');
    expect(form.allowedTools).toEqual(['file_read', 'git_diff']);
    expect(form.capabilities).toEqual(['architecture', 'documentation']);
    expect(form.isActive).toBe(false);
  });

  it('default capability catalog contains generic high-level capabilities', () => {
    const capabilities = listAvailableCapabilities(null);
    const values = capabilities.map((c) => c.value);
    expect(capabilities).toHaveLength(10);
    expect(values).toContain('coding');
    expect(values).toContain('code-review');
    expect(values).toContain('architecture');
    expect(values).toContain('testing');
    expect(values).toContain('security-review');
    expect(values).toContain('documentation');
    expect(values).toContain('requirements');
    expect(values).toContain('research');
    expect(values).toContain('project-management');
    expect(values).toContain('data-analysis');
    expect(values).not.toContain('llm-api');
    expect(values).not.toContain('lang:typescript');
    expect(values).not.toContain('role:developer');
    expect(values).not.toContain('bare-metal-exec');
    expect(values).not.toContain('gpu');
  });

  it('merges stored custom capabilities into the structured capability catalog', () => {
    const capabilities = listAvailableCapabilities({
      id: 'role-1',
      name: 'architect',
      capabilities: ['architecture', 'role:data-scientist'],
    });

    expect(capabilities.find((capability) => capability.value === 'role:data-scientist')).toEqual(
      expect.objectContaining({
        value: 'role:data-scientist',
        category: 'Custom',
      }),
    );
  });

  it('preserves only the primary model preference as an existing model option', () => {
    const options = buildRoleModelOptions(
      [
        {
          id: 'model-1',
          model_id: 'gpt-5.4',
          provider_name: 'OpenAI',
        },
      ],
      [],
      {
        id: 'role-1',
        name: 'developer',
        model_preference: 'legacy-primary',
      },
    );

    expect(options.find((option) => option.value === 'legacy-primary')).toEqual(
      expect.objectContaining({
        value: 'legacy-primary',
        source: 'existing',
      }),
    );
  });
});
