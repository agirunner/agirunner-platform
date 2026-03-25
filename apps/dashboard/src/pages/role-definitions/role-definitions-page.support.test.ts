import { describe, expect, it } from 'vitest';

import {
  buildRoleModelOptions,
  buildRolePayload,
  createRoleForm,
  createDuplicateRoleForm,
  listAvailableTools,
} from './role-definitions-page.support.js';

const toolCatalog = [
  {
    id: 'file_read',
    name: 'file_read',
    owner: 'task' as const,
    access_scope: 'specialist_and_orchestrator' as const,
  },
  {
    id: 'git_diff',
    name: 'git_diff',
    owner: 'task' as const,
    access_scope: 'specialist_and_orchestrator' as const,
  },
  {
    id: 'create_task',
    name: 'create_task',
    owner: 'runtime' as const,
    access_scope: 'orchestrator_only' as const,
  },
];

describe('role definitions support helpers', () => {
  it('includes allowed tools and active state in the save payload', () => {
    expect(
      buildRolePayload({
        name: ' architect ',
        description: ' designs systems ',
        systemPrompt: ' think deeply ',
        allowedTools: ['git_diff', 'git_diff', ' file_read '],
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
      is_active: false,
    });

    expect(form.name).toBe('');
    expect(form.description).toBe('System design specialist');
    expect(form.systemPrompt).toBe('Think about architecture deeply.');
    expect(form.allowedTools).toEqual(['file_read', 'git_diff']);
    expect(form.isActive).toBe(false);
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
        toolCatalog,
        { id: 'role-1', name: 'researcher', allowed_tools: ['file_read'] },
        {
          id: 'model-1',
          model_id: 'gpt-5.4',
          native_search: { mode: 'openai_web_search', defaultEnabled: true },
        },
      ),
    ).toContainEqual(expect.objectContaining({ id: 'native_search' }));

    expect(
      listAvailableTools(
        toolCatalog,
        { id: 'role-1', name: 'researcher', allowed_tools: ['file_read', 'native_search'] },
        {
          id: 'model-2',
          model_id: 'gpt-4o',
          native_search: null,
        },
      ),
    ).not.toContainEqual(expect.objectContaining({ id: 'native_search' }));
  });

  it('filters orchestrator-only tools out of the specialist role picker', () => {
    expect(
      listAvailableTools(
        toolCatalog,
        { id: 'role-1', name: 'researcher', allowed_tools: ['file_read', 'create_task'] },
        {
          id: 'model-2',
          model_id: 'gpt-4o',
          native_search: null,
        },
      ).map((tool) => tool.id),
    ).toEqual(['file_read', 'git_diff']);
  });
});
