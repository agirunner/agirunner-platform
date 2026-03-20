import { describe, expect, it } from 'vitest';

import {
  buildRoleModelOptions,
  buildRolePayload,
  createRoleForm,
  createDuplicateRoleForm,
  listAvailableCapabilities,
  listAvailableTools,
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
        executionContainer: {
          image: '',
          cpu: '',
          memory: '',
          pullPolicy: '',
        },
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

  it('includes execution container overrides only when a role sets them', () => {
    expect(
      buildRolePayload({
        name: 'developer',
        description: '',
        systemPrompt: '',
        allowedTools: ['file_read'],
        capabilities: ['coding'],
        isActive: true,
        executionContainer: {
          image: 'agirunner-runtime-execution:large',
          cpu: '2',
          memory: '4Gi',
          pullPolicy: 'always',
        },
      }),
    ).toEqual(
      expect.objectContaining({
        executionContainerConfig: {
          image: 'agirunner-runtime-execution:large',
          cpu: '2',
          memory: '4Gi',
          pullPolicy: 'always',
        },
      }),
    );
  });

  it('defaults role execution container pull policy to if-not-present', () => {
    expect(createRoleForm().executionContainer.pullPolicy).toBe('if-not-present');
  });

  it('fills in if-not-present when execution container overrides omit pull policy', () => {
    expect(
      buildRolePayload({
        name: 'developer',
        description: '',
        systemPrompt: '',
        allowedTools: ['file_read'],
        capabilities: ['coding'],
        isActive: true,
        executionContainer: {
          image: 'agirunner-runtime-execution:large',
          cpu: '2',
          memory: '4Gi',
          pullPolicy: '',
        },
      }),
    ).toEqual(
      expect.objectContaining({
        executionContainerConfig: {
          image: 'agirunner-runtime-execution:large',
          cpu: '2',
          memory: '4Gi',
          pullPolicy: 'if-not-present',
        },
      }),
    );
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
    expect(values).toContain('workspace-management');
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

  it('shows native_search only when the effective model supports provider-native search', () => {
    expect(
      listAvailableTools(
        { id: 'role-1', name: 'researcher', allowed_tools: ['file_read'] },
        {
          id: 'model-1',
          model_id: 'gpt-5.4',
          native_search: { mode: 'openai_web_search', defaultEnabled: true },
        },
      ),
    ).toContain('native_search');

    expect(
      listAvailableTools(
        { id: 'role-1', name: 'researcher', allowed_tools: ['file_read', 'native_search'] },
        {
          id: 'model-2',
          model_id: 'gpt-4o',
          native_search: null,
        },
      ),
    ).not.toContain('native_search');
  });
});
