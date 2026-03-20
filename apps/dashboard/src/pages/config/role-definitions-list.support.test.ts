import { describe, expect, it } from 'vitest';

import { buildRoleDetailSummary } from './role-definitions-list.support.js';

describe('role definitions list support', () => {
  it('builds structured detail summaries without a governance card', () => {
    const summary = buildRoleDetailSummary(
      {
        id: 'role-1',
        name: 'developer',
        allowed_tools: ['file_read', 'file_write'],
        capabilities: ['coding', 'testing'],
        model_preference: null,
        verification_strategy: 'peer-review',
        escalation_target: 'architect',
        max_escalation_depth: 3,
        execution_container_config: {
          image: 'ghcr.io/agirunner/execution:v1.2.3',
          cpu: '2',
          memory: '4Gi',
          pull_policy: 'if-not-present',
        },
        version: 7,
        updated_at: '2026-03-20T10:11:12.000Z',
        system_prompt:
          'You are a developer role. Verify changes before you stop. Escalate architecture concerns when a task crosses module boundaries.',
      },
      'System default',
    );

    expect(summary.model.label).toBe('System default');
    expect(summary.tools.label).toBe('2 tools enabled');
    expect(summary.executionContainer.label).toContain('ghcr.io/agirunner/execution:v1.2.3');
    expect(summary).not.toHaveProperty('governance');
    expect(summary.promptPreview).toContain('You are a developer role.');
    expect(summary.promptPreview).toContain('Escalate architecture concerns');
  });
});
