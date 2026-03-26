import { describe, expect, it } from 'vitest';

import {
  summarizeRoleSetup,
  validateRoleDialog,
} from './role-definitions-dialog.support.js';
import { createRoleForm } from './role-definitions-page.support.js';

describe('role dialog support', () => {
  it('blocks duplicate names while surfacing advisory guidance', () => {
    const result = validateRoleDialog(
      {
        ...createRoleForm(),
        name: 'Architect',
        allowedTools: [],
        mcpServerIds: ['server-1'],
        skillIds: ['skill-1'],
      },
      [{ id: 'role-1', name: 'architect' }],
    );

    expect(result.isValid).toBe(false);
    expect(result.fieldErrors).toMatchObject({
      name: 'Choose a unique role name.',
    });
    expect(result.advisoryIssues).toEqual(
      expect.arrayContaining([
        'Add a system prompt so the orchestrator understands how the role should behave.',
        'Enable at least one tool or confirm that this role should be read-only.',
      ]),
    );
  });

  it('summarizes role posture in operator-facing language', () => {
    expect(
      summarizeRoleSetup({
        ...createRoleForm(),
        allowedTools: ['file_read'],
        mcpServerIds: ['server-1'],
        skillIds: ['skill-1', 'skill-2'],
        executionEnvironmentId: '',
      }),
    ).toEqual({
      toolSummary: '1 tool enabled',
      modelSummary: 'Model assigned on Models page',
      environmentSummary: 'Uses default environment',
      remoteMcpSummary: '1 remote MCP server granted',
      skillSummary: '2 skills assigned',
    });
  });

  it('summarizes explicit environment selection in operator-facing language', () => {
    const result = validateRoleDialog(
      {
        ...createRoleForm(),
        name: 'Developer',
        mcpServerIds: [],
        skillIds: [],
        executionEnvironmentId: 'environment-123',
      },
      [],
    );

    expect(result.isValid).toBe(true);
    expect(result.fieldErrors).toEqual({});
  });
});
