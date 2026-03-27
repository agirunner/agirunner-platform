import { describe, expect, it } from 'vitest';

import {
  buildRoleExecutionEnvironmentOptions,
  buildRoleModelOptions,
  buildRolePayload,
  createRoleForm,
  createDuplicateRoleForm,
  formatRoleDeleteError,
  isSelectableExecutionEnvironment,
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
        mcpServerIds: ['server-2', 'server-1', 'server-2'],
        skillIds: ['skill-2', 'skill-1', 'skill-2'],
        isActive: false,
        executionEnvironmentId: '',
      }),
    ).toEqual({
      name: 'architect',
      description: 'designs systems',
      systemPrompt: 'think deeply',
      allowedTools: ['git_diff', 'file_read'],
      mcpServerIds: ['server-2', 'server-1'],
      skillIds: ['skill-2', 'skill-1'],
      executionEnvironmentId: null,
      isActive: false,
    });
  });

  it('includes an execution environment override only when a role sets one', () => {
    expect(
      buildRolePayload({
        name: 'developer',
        description: '',
        systemPrompt: '',
        allowedTools: ['file_read'],
        mcpServerIds: [],
        skillIds: [],
        isActive: true,
        executionEnvironmentId: 'environment-123',
      }),
    ).toEqual(
      expect.objectContaining({
        executionEnvironmentId: 'environment-123',
      }),
    );
  });

  it('defaults to the shared execution environment when no override is set', () => {
    expect(createRoleForm().executionEnvironmentId).toBe('');
    expect(createRoleForm().mcpServerIds).toEqual([]);
    expect(createRoleForm().skillIds).toEqual([]);
  });

  it('preselects remote MCP servers enabled by default for new specialists', () => {
    const form = createRoleForm(null, [], ['server-2', 'server-1']);

    expect(form.mcpServerIds).toEqual(['server-2', 'server-1']);
    expect(form.skillIds).toEqual([]);
  });

  it('hydrates the current execution environment override into the form', () => {
    const form = createRoleForm({
      id: 'role-1',
      name: 'developer',
      execution_environment_id: 'environment-123',
      mcp_server_ids: ['server-1'],
      skill_ids: ['skill-2', 'skill-1'],
    });

    expect(form.executionEnvironmentId).toBe('environment-123');
    expect(form.mcpServerIds).toEqual(['server-1']);
    expect(form.skillIds).toEqual(['skill-2', 'skill-1']);
  });

  it('creates a duplicate form that clears the name and preserves all other role fields', () => {
    const form = createDuplicateRoleForm({
      id: 'role-1',
      name: 'architect',
      description: 'System design specialist',
      system_prompt: 'Think about architecture deeply.',
      allowed_tools: ['file_read', 'git_diff'],
      mcp_server_ids: ['server-1'],
      skill_ids: ['skill-1', 'skill-2'],
      is_active: false,
    });

    expect(form.name).toBe('');
    expect(form.description).toBe('System design specialist');
    expect(form.systemPrompt).toBe('Think about architecture deeply.');
    expect(form.allowedTools).toEqual(['file_read', 'git_diff']);
    expect(form.mcpServerIds).toEqual(['server-1']);
    expect(form.skillIds).toEqual(['skill-1', 'skill-2']);
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

  it('treats archived environments as non-selectable for new role assignments', () => {
    expect(
      isSelectableExecutionEnvironment({
        id: 'environment-1',
        name: 'Ubuntu archived',
        source_kind: 'catalog',
        image: 'ubuntu:24.04',
        cpu: '2',
        memory: '1g',
        pull_policy: 'if-not-present',
        compatibility_status: 'compatible',
        support_status: 'active',
        is_archived: true,
      }),
    ).toBe(false);
  });

  it('keeps a currently selected archived environment visible while excluding other archived choices', () => {
    const activeEnvironment = {
      id: 'environment-active',
      name: 'Debian Base',
      source_kind: 'catalog' as const,
      image: 'debian:trixie-slim',
      cpu: '1',
      memory: '768m',
      pull_policy: 'if-not-present' as const,
      compatibility_status: 'compatible' as const,
      support_status: 'active' as const,
      is_archived: false,
    };
    const archivedEnvironment = {
      id: 'environment-archived',
      name: 'Fedora archived',
      source_kind: 'custom' as const,
      image: 'fedora:42',
      cpu: '2',
      memory: '1g',
      pull_policy: 'always' as const,
      compatibility_status: 'compatible' as const,
      support_status: 'active' as const,
      is_archived: true,
    };

    expect(
      buildRoleExecutionEnvironmentOptions(
        [activeEnvironment, archivedEnvironment],
        'environment-archived',
      ).map((environment) => environment.id),
    ).toEqual(['environment-active', 'environment-archived']);

    expect(
      buildRoleExecutionEnvironmentOptions([activeEnvironment, archivedEnvironment], '').map(
        (environment) => environment.id,
      ),
    ).toEqual(['environment-active']);
  });

  it('formats role delete conflicts for inline dialog display without the raw HTTP status', () => {
    expect(
      formatRoleDeleteError(
        new Error(
          'HTTP 409: Cannot delete role "all-request-architecture-lead" — used by playbook: SDLC All Assessors Request Changes Pipeline.',
        ),
      ),
    ).toBe(
      'This specialist is still used by playbook "SDLC All Assessors Request Changes Pipeline". Update that playbook before deleting the specialist.',
    );

    expect(
      formatRoleDeleteError(
        new Error(
          'HTTP 409: Cannot delete role "all-request-architecture-lead" — referenced by workflow playbook versions: SDLC All Assessors Request Changes Pipeline.',
        ),
      ),
    ).toBe(
      'This specialist is still referenced by workflow-linked playbook versions "SDLC All Assessors Request Changes Pipeline". Delete those workflows before deleting the specialist.',
    );

    expect(formatRoleDeleteError(new Error('HTTP 500: Internal server error'))).toBe(
      'Internal server error',
    );
  });
});
