import { describe, expect, it } from 'vitest';

import {
  buildWebSearchRecoveryGuidance,
  getWebSearchProviderDetails,
  listWebSearchProviderDetails,
  resolveWebSearchProvider,
  shouldShowWebSearchApiKey,
  summarizeWebSearchPosture,
} from './runtime-defaults-search.support.js';

describe('runtime defaults search support', () => {
  it('falls back to duckduckgo when the provider is unset or invalid', () => {
    expect(resolveWebSearchProvider({})).toBe('duckduckgo');
    expect(resolveWebSearchProvider({ 'tools.web_search_provider': 'bing' })).toBe(
      'duckduckgo',
    );
  });

  it('shows the api key field only for providers that need one or when a stale value exists', () => {
    expect(shouldShowWebSearchApiKey({ 'tools.web_search_provider': 'duckduckgo' })).toBe(
      false,
    );
    expect(
      shouldShowWebSearchApiKey({
        'tools.web_search_provider': 'serper',
      }),
    ).toBe(true);
    expect(
      shouldShowWebSearchApiKey({
        'tools.web_search_provider': 'duckduckgo',
        'tools.web_search_api_key_secret_ref': 'secret:SERPER_API_KEY',
      }),
    ).toBe(true);
  });

  it('summarizes provider posture with endpoint and secret state', () => {
    expect(
      summarizeWebSearchPosture({
        'tools.web_search_provider': 'tavily',
        'tools.web_search_api_key_secret_ref': 'secret:TAVILY_API_KEY',
      }),
    ).toEqual({
      providerLabel: 'Tavily',
      providerDescription: 'Search tuned for AI research workflows. Requires a secret-ref API key.',
      endpointStatus: 'Using provider default endpoint.',
      apiKeyStatus: 'Secret reference configured.',
    });

    expect(
      summarizeWebSearchPosture({
        'tools.web_search_provider': 'duckduckgo',
        'tools.web_search_api_key_secret_ref': 'secret:LEGACY_KEY',
        'tools.web_search_base_url': 'https://html.duckduckgo.com/html',
      }),
    ).toEqual({
      providerLabel: 'DuckDuckGo',
      providerDescription: 'Built-in fallback provider. No API key is required.',
      endpointStatus: 'Custom endpoint override configured.',
      apiKeyStatus: 'Unused secret reference is still stored.',
    });
  });

  it('exposes provider labels and placeholders for the first-class control', () => {
    expect(listWebSearchProviderDetails()).toEqual([
      {
        value: 'duckduckgo',
        label: 'DuckDuckGo',
        description: 'Built-in fallback provider. No API key is required.',
        endpointPlaceholder: 'https://html.duckduckgo.com/html',
        requiresApiKey: false,
      },
      {
        value: 'serper',
        label: 'Serper',
        description: 'Google-backed search results. Requires a secret-ref API key.',
        endpointPlaceholder: 'https://google.serper.dev/search',
        requiresApiKey: true,
      },
      {
        value: 'tavily',
        label: 'Tavily',
        description: 'Search tuned for AI research workflows. Requires a secret-ref API key.',
        endpointPlaceholder: 'https://api.tavily.com/search',
        requiresApiKey: true,
      },
    ]);
    expect(getWebSearchProviderDetails('serper').requiresApiKey).toBe(true);
  });

  it('builds provider-specific recovery guidance from the current posture and validation state', () => {
    expect(
      buildWebSearchRecoveryGuidance(
        {
          'tools.web_search_provider': 'serper',
        },
        {
          'tools.web_search_api_key_secret_ref':
            'Serper requires a secret reference. Add one or switch the provider back to DuckDuckGo.',
        },
      ),
    ).toEqual([
      'Use a secret:NAME reference for the provider API key.',
      'Add a Serper secret reference or switch the provider back to DuckDuckGo.',
    ]);

    expect(
      buildWebSearchRecoveryGuidance(
        {
          'tools.web_search_provider': 'duckduckgo',
          'tools.web_search_api_key_secret_ref': 'secret:LEGACY_KEY',
        },
        {},
      ),
    ).toEqual([
      'Clear the stale secret reference because DuckDuckGo does not use an API key.',
    ]);
  });
});
