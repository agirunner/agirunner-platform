import { describe, expect, it } from 'vitest';

import {
  describeProviderTypeSetup,
  summarizeAssignmentSurface,
  validateAssignmentSetup,
  validateAddProviderDraft,
} from './llm-providers-page.support.js';

describe('llm providers page support', () => {
  it('validates required provider inputs with operator-facing guidance', () => {
    expect(
      validateAddProviderDraft({
        providerType: 'openai',
        name: '',
        baseUrl: 'http://api.openai.com/v1',
        apiKey: '',
      }),
    ).toEqual({
      fieldErrors: {
        name: 'Enter a provider name.',
        baseUrl: 'Enter a valid https:// endpoint.',
        apiKey: 'Paste the provider API key.',
      },
      issues: [
        'Enter a provider name.',
        'Enter a valid https:// endpoint.',
        'Paste the provider API key.',
      ],
      isValid: false,
    });
  });

  it('allows openai-compatible providers to omit the api key and use http endpoints', () => {
    const result = validateAddProviderDraft({
      providerType: 'openai-compatible',
      name: 'Local Ollama',
      baseUrl: 'http://localhost:11434/v1',
      apiKey: '',
    });

    expect(result.isValid).toBe(true);
    expect(result.fieldErrors).toEqual({});
  });

  it('rejects duplicate provider names with recovery guidance', () => {
    const result = validateAddProviderDraft(
      {
        providerType: 'anthropic',
        name: '  openai  ',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'secret',
      },
      {
        existingNames: ['OpenAI', 'Google'],
      },
    );

    expect(result).toEqual({
      fieldErrors: {
        name: 'Choose a distinct provider name. This label is already in use.',
      },
      issues: ['Choose a distinct provider name. This label is already in use.'],
      isValid: false,
    });
  });

  it('describes provider setup expectations for each provider type', () => {
    expect(describeProviderTypeSetup('openai')).toEqual({
      title: 'OpenAI API',
      detail: 'Uses the hosted OpenAI API endpoint with a standard provider key.',
      authLabel: 'API key required',
    });
    expect(describeProviderTypeSetup('openai-compatible')).toEqual({
      title: 'Compatible endpoint',
      detail: 'Best for Ollama, vLLM, or another OpenAI-style gateway that you control.',
      authLabel: 'API key optional',
    });
  });

  it('blocks saves when no effective model remains for inherited roles', () => {
    expect(
      validateAssignmentSetup({
        defaultModelId: '__none__',
        roleAssignments: [
          { roleName: 'orchestrator', modelId: '__none__' },
          { roleName: 'developer', modelId: 'model-1' },
          { roleName: 'reviewer', modelId: '__none__' },
        ],
      }),
    ).toEqual({
      missingRoleNames: ['orchestrator', 'reviewer'],
      blockingIssues: [
        'Choose a system default model or assign explicit models for: orchestrator, reviewer.',
      ],
      isValid: false,
    });
  });

  it('surfaces a single shared coverage blocker when inherited roles have no model source', () => {
    const summary = summarizeAssignmentSurface({
      enabledModelCount: 3,
      defaultModelConfigured: false,
      roleCount: 3,
      explicitOverrideCount: 1,
      staleRoleCount: 0,
      inactiveRoleCount: 0,
      missingAssignmentCount: 0,
      blockingIssues: [
        'Choose a system default model or assign explicit models for: orchestrator, reviewer.',
      ],
    });

    expect(summary.guidance).toEqual({
      tone: 'warning',
      headline: 'Assignment coverage needs attention',
      detail: 'Choose a system default model or assign explicit models for: orchestrator, reviewer.',
    });
    expect(summary.cards[0]).toEqual({
      label: 'Default route',
      value: 'No system default',
      detail: 'Pick a shared default or assign every role explicitly.',
    });
  });

  it('allows assignment saves when every role keeps an effective model', () => {
    expect(
      validateAssignmentSetup({
        defaultModelId: 'model-default',
        roleAssignments: [
          { roleName: 'orchestrator', modelId: '__none__' },
          { roleName: 'developer', modelId: '__none__' },
        ],
      }),
    ).toEqual({
      missingRoleNames: [],
      blockingIssues: [],
      isValid: true,
    });
  });

  it('summarizes assignment blockers when no enabled models remain', () => {
    expect(
      summarizeAssignmentSurface({
        enabledModelCount: 0,
        defaultModelConfigured: false,
        roleCount: 3,
        explicitOverrideCount: 1,
        staleRoleCount: 1,
        inactiveRoleCount: 1,
        missingAssignmentCount: 0,
        blockingIssues: [
          'Choose a system default model or assign explicit models for: orchestrator, reviewer.',
        ],
      }),
    ).toEqual({
      cards: [
        {
          label: 'Default route',
          value: 'No system default',
          detail: 'Pick a shared default or assign every role explicitly.',
        },
        {
          label: 'Explicit overrides',
          value: '1/3',
          detail: '2 roles inherit the shared default.',
        },
        {
          label: 'Catalog posture',
          value: 'No enabled models',
          detail: '1 inactive role still need cleanup.',
        },
      ],
      guidance: {
        tone: 'danger',
        headline: 'Assignments are blocked',
        detail:
          'Add or enable at least one model before configuring the system default or per-role overrides.',
      },
    });
  });

  it('summarizes ready assignment coverage when defaults and overrides are configured', () => {
    expect(
      summarizeAssignmentSurface({
        enabledModelCount: 5,
        defaultModelConfigured: true,
        roleCount: 4,
        explicitOverrideCount: 2,
        staleRoleCount: 0,
        inactiveRoleCount: 0,
        missingAssignmentCount: 0,
        blockingIssues: [],
      }),
    ).toEqual({
      cards: [
        {
          label: 'Default route',
          value: 'System default set',
          detail: 'Roles without overrides inherit the shared model route.',
        },
        {
          label: 'Explicit overrides',
          value: '2/4',
          detail: '2 roles inherit the shared default.',
        },
        {
          label: 'Catalog posture',
          value: '5 enabled models',
          detail: 'No stale assignment rows remain.',
        },
      ],
      guidance: {
        tone: 'success',
        headline: 'Assignments are ready to save',
        detail:
          'System default coverage and role overrides are aligned for the current model catalog.',
      },
    });
  });

  it('spells out missing assignments separately from inactive roles in catalog posture', () => {
    expect(
      summarizeAssignmentSurface({
        enabledModelCount: 2,
        defaultModelConfigured: true,
        roleCount: 4,
        explicitOverrideCount: 1,
        staleRoleCount: 2,
        inactiveRoleCount: 1,
        missingAssignmentCount: 1,
        blockingIssues: [],
      }),
    ).toEqual({
      cards: [
        {
          label: 'Default route',
          value: 'System default set',
          detail: 'Roles without overrides inherit the shared model route.',
        },
        {
          label: 'Explicit overrides',
          value: '1/4',
          detail: '3 roles inherit the shared default.',
        },
        {
          label: 'Catalog posture',
          value: '2 enabled models',
          detail: '1 inactive role still need cleanup. 1 missing assignment still need cleanup.',
        },
      ],
      guidance: {
        tone: 'success',
        headline: 'Assignments are ready to save',
        detail:
          'System default coverage and role overrides are aligned for the current model catalog.',
      },
    });
  });
});
