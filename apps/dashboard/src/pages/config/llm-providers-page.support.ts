export type ProviderType = 'openai' | 'anthropic' | 'google' | 'openai-compatible' | 'openai-codex';

export interface AddProviderDraft {
  providerType: ProviderType;
  name: string;
  baseUrl: string;
  apiKey: string;
}

export interface AddProviderValidation {
  fieldErrors: {
    name?: string;
    baseUrl?: string;
    apiKey?: string;
  };
  issues: string[];
  isValid: boolean;
}

export interface AddProviderValidationContext {
  existingNames?: string[];
}

export function describeProviderTypeSetup(providerType: ProviderType): {
  title: string;
  detail: string;
  authLabel: string;
} {
  if (providerType === 'openai-compatible') {
    return {
      title: 'Compatible endpoint',
      detail: 'Best for Ollama, vLLM, or another OpenAI-style gateway that you control.',
      authLabel: 'API key optional',
    };
  }
  if (providerType === 'openai-codex') {
    return {
      title: 'Subscription provider',
      detail: 'Uses the ChatGPT subscription backend and should keep the hosted secure endpoint.',
      authLabel: 'Subscription auth required',
    };
  }
  if (providerType === 'anthropic') {
    return {
      title: 'Anthropic API',
      detail: 'Uses Anthropic-hosted models with a managed HTTPS endpoint.',
      authLabel: 'API key required',
    };
  }
  if (providerType === 'google') {
    return {
      title: 'Google API',
      detail: 'Uses the hosted Gemini endpoint with Google API authentication.',
      authLabel: 'API key required',
    };
  }
  return {
    title: 'OpenAI API',
    detail: 'Uses the hosted OpenAI API endpoint with a standard provider key.',
    authLabel: 'API key required',
  };
}

export function validateAddProviderDraft(
  draft: AddProviderDraft,
  context: AddProviderValidationContext = {},
): AddProviderValidation {
  const fieldErrors: AddProviderValidation['fieldErrors'] = {};
  const normalizedName = draft.name.trim();

  if (!normalizedName) {
    fieldErrors.name = 'Enter a provider name.';
  } else if (hasDuplicateProviderName(normalizedName, context.existingNames ?? [])) {
    fieldErrors.name = 'Choose a distinct provider name. This label is already in use.';
  }

  if (!draft.baseUrl.trim()) {
    fieldErrors.baseUrl = 'Enter the provider base URL.';
  } else if (!isValidProviderUrl(draft.baseUrl.trim(), draft.providerType)) {
    fieldErrors.baseUrl =
      draft.providerType === 'openai-compatible'
        ? 'Enter a valid http:// or https:// endpoint.'
        : 'Enter a valid https:// endpoint.';
  }

  if (draft.providerType !== 'openai-compatible' && !draft.apiKey.trim()) {
    fieldErrors.apiKey = 'Paste the provider API key.';
  }

  const issues = Object.values(fieldErrors);
  return {
    fieldErrors,
    issues,
    isValid: issues.length === 0,
  };
}

function hasDuplicateProviderName(name: string, existingNames: string[]): boolean {
  const normalizedName = normalizeProviderName(name);
  return existingNames.some((value) => normalizeProviderName(value) === normalizedName);
}

function normalizeProviderName(value: string): string {
  return value.trim().toLowerCase();
}

function isValidProviderUrl(value: string, providerType: ProviderType): boolean {
  try {
    const url = new URL(value);
    if (providerType === 'openai-compatible') {
      return url.protocol === 'http:' || url.protocol === 'https:';
    }
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}
