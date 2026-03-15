import { describe, expect, it } from 'vitest';

import {
  summarizeRoleSetup,
  validateRoleDialog,
} from './role-definitions-dialog.support.js';
import { createRoleForm } from './role-definitions-page.support.js';

describe('role dialog support', () => {
  it('blocks duplicate names and invalid fallback routing while surfacing advisory guidance', () => {
    const result = validateRoleDialog(
      {
        ...createRoleForm(),
        name: 'Architect',
        modelPreference: 'gpt-5.4',
        fallbackModel: 'gpt-5.4',
        allowedTools: [],
      },
      [{ id: 'role-1', name: 'architect' }],
    );

    expect(result.isValid).toBe(false);
    expect(result.fieldErrors).toMatchObject({
      name: 'Choose a unique role name.',
      fallbackModel: 'Choose a fallback model that differs from the preferred model.',
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
        modelPreference: 'gpt-5.4',
        fallbackModel: 'gpt-4.1',
      }),
    ).toEqual({
      toolSummary: '1 tool enabled',
      modelSummary: 'gpt-5.4 with gpt-4.1 fallback',
    });
  });
});
