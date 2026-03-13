import { describe, expect, it } from 'vitest';

import {
  describeProviderTypeSetup,
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
});
