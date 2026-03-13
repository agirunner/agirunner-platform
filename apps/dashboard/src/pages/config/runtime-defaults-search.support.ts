import { WEB_SEARCH_PROVIDER_OPTIONS } from './runtime-defaults.schema.js';
import type { FormValues } from './runtime-defaults.types.js';

export type WebSearchProvider = (typeof WEB_SEARCH_PROVIDER_OPTIONS)[number];

interface WebSearchProviderDetails {
  value: WebSearchProvider;
  label: string;
  description: string;
  endpointPlaceholder: string;
  requiresApiKey: boolean;
}

const PROVIDER_DETAILS: Record<WebSearchProvider, WebSearchProviderDetails> = {
  duckduckgo: {
    value: 'duckduckgo',
    label: 'DuckDuckGo',
    description: 'Built-in fallback provider. No API key is required.',
    endpointPlaceholder: 'https://html.duckduckgo.com/html',
    requiresApiKey: false,
  },
  serper: {
    value: 'serper',
    label: 'Serper',
    description: 'Google-backed search results. Requires a secret-ref API key.',
    endpointPlaceholder: 'https://google.serper.dev/search',
    requiresApiKey: true,
  },
  tavily: {
    value: 'tavily',
    label: 'Tavily',
    description: 'Search tuned for AI research workflows. Requires a secret-ref API key.',
    endpointPlaceholder: 'https://api.tavily.com/search',
    requiresApiKey: true,
  },
};

export interface WebSearchPostureSummary {
  providerLabel: string;
  providerDescription: string;
  endpointStatus: string;
  apiKeyStatus: string;
}

export function buildWebSearchRecoveryGuidance(
  values: FormValues,
  errors: Record<string, string>,
): string[] {
  const provider = resolveWebSearchProvider(values);
  const details = PROVIDER_DETAILS[provider];
  const guidance = new Set<string>();

  if (errors['tools.web_search_base_url']) {
    guidance.add('Clear the endpoint override or enter a full http or https URL.');
  }
  if (errors['tools.web_search_api_key_secret_ref']) {
    guidance.add('Use a secret:NAME reference for the provider API key.');
  }
  if (
    details.requiresApiKey &&
    errors['tools.web_search_api_key_secret_ref']?.includes('requires a secret reference')
  ) {
    guidance.add(`Add a ${details.label} secret reference or switch the provider back to DuckDuckGo.`);
  }
  if (
    !details.requiresApiKey &&
    values['tools.web_search_api_key_secret_ref']?.trim()
  ) {
    guidance.add('Clear the stale secret reference because DuckDuckGo does not use an API key.');
  }
  if (!guidance.size) {
    guidance.add('Provider posture is ready to save.');
  }

  return [...guidance];
}

export function resolveWebSearchProvider(values: FormValues): WebSearchProvider {
  const raw = values['tools.web_search_provider']?.trim().toLowerCase();
  if (!raw) {
    return 'duckduckgo';
  }
  return isWebSearchProvider(raw) ? raw : 'duckduckgo';
}

export function listWebSearchProviderDetails(): WebSearchProviderDetails[] {
  return WEB_SEARCH_PROVIDER_OPTIONS.map((provider) => PROVIDER_DETAILS[provider]);
}

export function getWebSearchProviderDetails(
  provider: WebSearchProvider,
): WebSearchProviderDetails {
  return PROVIDER_DETAILS[provider];
}

export function shouldShowWebSearchApiKey(values: FormValues): boolean {
  const provider = resolveWebSearchProvider(values);
  return (
    PROVIDER_DETAILS[provider].requiresApiKey ||
    Boolean(values['tools.web_search_api_key_secret_ref']?.trim())
  );
}

export function summarizeWebSearchPosture(values: FormValues): WebSearchPostureSummary {
  const provider = resolveWebSearchProvider(values);
  const details = PROVIDER_DETAILS[provider];
  const endpointValue = values['tools.web_search_base_url']?.trim();
  const apiKeyValue = values['tools.web_search_api_key_secret_ref']?.trim();

  return {
    providerLabel: details.label,
    providerDescription: details.description,
    endpointStatus: endpointValue
      ? 'Custom endpoint override configured.'
      : 'Using provider default endpoint.',
    apiKeyStatus: details.requiresApiKey
      ? apiKeyValue
        ? 'Secret reference configured.'
        : 'Secret reference still required.'
      : apiKeyValue
        ? 'Unused secret reference is still stored.'
        : 'No secret reference required.',
  };
}

function isWebSearchProvider(value: string): value is WebSearchProvider {
  return WEB_SEARCH_PROVIDER_OPTIONS.includes(value as WebSearchProvider);
}
