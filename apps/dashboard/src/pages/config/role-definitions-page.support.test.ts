import { describe, expect, it } from 'vitest';

import {
  buildRoleModelOptions,
  buildRolePayload,
  listAvailableCapabilities,
} from './role-definitions-page.support.js';

describe('role definitions support helpers', () => {
  it('includes model preference, fallback model, capabilities, and active state in the save payload', () => {
    expect(
      buildRolePayload({
        name: ' architect ',
        description: ' designs systems ',
        systemPrompt: ' think deeply ',
        allowedTools: ['git_diff', 'git_diff', ' file_read '],
        capabilities: ['role:architect', ' role:architect ', 'web-research'],
        modelPreference: 'gpt-5.4',
        fallbackModel: 'gpt-4.1',
        verificationStrategy: 'peer_review',
        escalationTarget: 'human',
        maxEscalationDepth: 3,
        isActive: false,
      }),
    ).toEqual({
      name: 'architect',
      description: 'designs systems',
      systemPrompt: 'think deeply',
      allowedTools: ['git_diff', 'file_read'],
      capabilities: ['role:architect', 'web-research'],
      modelPreference: 'gpt-5.4',
      fallbackModel: 'gpt-4.1',
      verificationStrategy: 'peer_review',
      escalationTarget: 'human',
      maxEscalationDepth: 3,
      isActive: false,
    });
  });

  it('keeps existing stored model values selectable when they are outside the live catalog', () => {
    expect(
      buildRoleModelOptions(
        [{ id: 'model-1', model_id: 'gpt-5.4', provider_id: 'provider-1', is_enabled: true }],
        [{ id: 'provider-1', name: 'OpenAI (Subscription)' }],
        { id: 'role-1', name: 'architect', model_preference: 'legacy-model', fallback_model: 'gpt-5.4' },
      ).map((option) => option.label),
    ).toEqual([
      'legacy-model (existing selection)',
      'OpenAI (Subscription) / gpt-5.4',
    ]);
  });

  it('merges stored custom capabilities into the structured capability catalog', () => {
    const capabilities = listAvailableCapabilities({
      id: 'role-1',
      name: 'architect',
      capabilities: ['role:architect', 'role:data-scientist'],
    });

    expect(capabilities.find((capability) => capability.value === 'role:data-scientist')).toEqual(
      expect.objectContaining({
        value: 'role:data-scientist',
        category: 'Custom',
      }),
    );
  });
});
