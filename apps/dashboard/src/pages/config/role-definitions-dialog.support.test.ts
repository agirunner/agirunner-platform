import { describe, expect, it } from 'vitest';

import {
  buildEscalationTargetOptions,
  readCustomCapabilityError,
  readCustomToolError,
  summarizeRoleSetup,
  validateRoleDialog,
} from './role-definitions-dialog.support.js';
import { createRoleForm } from './role-definitions-page.support.js';

describe('role dialog support', () => {
  it('keeps a stored escalation target selectable even when the target role is no longer present', () => {
    expect(
      buildEscalationTargetOptions(
        [{ id: 'role-1', name: 'reviewer' }],
        { id: 'role-2', name: 'developer', escalation_target: 'legacy-role' },
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: 'legacy-role',
          label: 'legacy-role (existing target)',
        }),
      ]),
    );
  });

  it('blocks duplicate names and invalid fallback routing while surfacing advisory guidance', () => {
    const result = validateRoleDialog(
      {
        ...createRoleForm(),
        name: 'Architect',
        modelPreference: 'gpt-5.4',
        fallbackModel: 'gpt-5.4',
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
        'Add a system prompt so operators and orchestrators can understand how the role should behave.',
        'Add at least one capability so routing and staffing summaries stay meaningful.',
        'Add at least one tool grant or confirm that this role should stay read-only.',
      ]),
    );
  });

  it('summarizes role posture in operator-facing language', () => {
    expect(
      summarizeRoleSetup({
        ...createRoleForm(),
        capabilities: ['architecture', 'documentation'],
        allowedTools: ['file_read'],
        modelPreference: 'gpt-5.4',
        fallbackModel: 'gpt-4.1',
        verificationStrategy: 'peer_review',
        escalationTarget: 'human',
        maxEscalationDepth: 2,
      }),
    ).toEqual({
      capabilitySummary: '2 capabilities selected',
      toolSummary: '1 tool grant selected',
      modelSummary: 'gpt-5.4 with gpt-4.1 fallback',
      reviewSummary: 'Peer review required',
      escalationSummary: 'Escalates to a human operator after 2 handoffs',
    });
  });

  it('explains blank, duplicate, and malformed custom additions before they silently fail', () => {
    expect(readCustomCapabilityError('', [])).toBe('Enter a custom capability before adding it.');
    expect(readCustomCapabilityError('architecture', ['architecture'])).toBe(
      'This capability is already added.',
    );
    expect(readCustomCapabilityError('role data scientist', [])).toBe(
      'Use an ID-style capability without spaces, for example role:data-scientist.',
    );
    expect(readCustomToolError('', [])).toBe('Enter a custom tool grant before adding it.');
    expect(readCustomToolError('artifact_read', ['artifact_read'])).toBe(
      'This tool grant is already added.',
    );
    expect(readCustomToolError('artifact read', [])).toBe(
      'Use a single tool ID without spaces, for example artifact_read.',
    );
  });
});
