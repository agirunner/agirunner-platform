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
      }),
    ).toEqual({
      toolSummary: '1 tool enabled',
      modelSummary: 'Model assigned via LLM Providers',
    });
  });

  it('surfaces execution container field errors for invalid overrides', () => {
    const result = validateRoleDialog(
      {
        ...createRoleForm(),
        name: 'Developer',
        executionContainer: {
          image: 'https://ghcr.io/agirunner/runtime latest',
          cpu: 'zero',
          memory: 'banana',
          pullPolicy: '',
        },
      },
      [],
    );

    expect(result.isValid).toBe(false);
    expect(result.fieldErrors).toMatchObject({
      executionContainerImage: expect.stringContaining('valid container image reference'),
      executionContainerCpu: expect.stringContaining('positive number'),
      executionContainerMemory: expect.stringContaining('512m, 2g, or 2Gi'),
    });
  });
});
