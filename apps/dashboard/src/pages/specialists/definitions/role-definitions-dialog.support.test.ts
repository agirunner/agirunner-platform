import { describe, expect, it } from 'vitest';

import {
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
    expect(result.fieldErrors).toHaveProperty('name');
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
