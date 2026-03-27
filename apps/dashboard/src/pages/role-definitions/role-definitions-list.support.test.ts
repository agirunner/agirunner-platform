import { describe, expect, it } from 'vitest';

import { buildRoleDetailSummary } from './role-definitions-list.support.js';

describe('role definitions list support', () => {
  it('builds structured detail summaries without a governance card', () => {
    const summary = buildRoleDetailSummary(
      {
        id: 'role-1',
        name: 'developer',
        allowed_tools: ['file_read', 'file_write'],
        mcp_server_ids: ['server-1'],
        model_preference: null,
        verification_strategy: 'peer-review',
        escalation_target: 'architect',
        max_escalation_depth: 3,
        execution_environment: {
          id: 'environment-1',
          name: 'Ubuntu 24.04 / Go',
          source_kind: 'catalog',
          catalog_key: 'ubuntu-go',
          catalog_version: 2,
          image: 'ubuntu:24.04',
          cpu: '2',
          memory: '4Gi',
          pull_policy: 'if-not-present',
          compatibility_status: 'compatible',
          support_status: 'active',
          verification_contract_version: 'v1',
          verified_metadata: {},
          tool_capabilities: {},
          bootstrap_commands: [],
          bootstrap_required_domains: [],
          agent_hint: 'Execution environment: Ubuntu 24.04 / Go',
        },
        version: 7,
        updated_at: '2026-03-20T10:11:12.000Z',
        system_prompt:
          'You are a developer role. Verify changes before you stop. Escalate architecture concerns when a task crosses module boundaries.',
      },
      'System default',
    );

    expect(summary.model.label).toBe('System default');
    expect(summary.tools.label).toBe('2 tools and 1 MCP server enabled');
    expect(summary.executionEnvironment.label).toContain('Ubuntu 24.04 / Go');
    expect(summary.executionEnvironment.label).toContain('ubuntu:24.04');
    expect(summary).not.toHaveProperty('governance');
    expect(summary.promptPreview).toContain('You are a developer role.');
    expect(summary.promptPreview).toContain('Escalate architecture concerns');
  });
});
