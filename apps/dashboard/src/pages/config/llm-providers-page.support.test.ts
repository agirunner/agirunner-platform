import { describe, expect, it } from 'vitest';

import {
  describeProviderTypeSetup,
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
});
