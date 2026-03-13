import { getWebSearchProviderDetails, resolveWebSearchProvider } from './runtime-defaults-search.support.js';
import { FIELD_DEFINITIONS } from './runtime-defaults.schema.js';
import type { FormValues } from './runtime-defaults.types.js';

export function buildValidationErrors(values: FormValues): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const field of FIELD_DEFINITIONS) {
    if (field.configType !== 'number') {
      continue;
    }
    const value = values[field.key]?.trim();
    if (!value) {
      continue;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      errors[field.key] = `${field.label} must be a number.`;
      continue;
    }
    if (field.inputMode === 'numeric' && !Number.isInteger(parsed)) {
      errors[field.key] = `${field.label} must be a whole number.`;
      continue;
    }
    if (field.min !== undefined && parsed < field.min) {
      errors[field.key] = `${field.label} must be at least ${field.min}.`;
      continue;
    }
    if (field.max !== undefined && parsed > field.max) {
      errors[field.key] = `${field.label} must be at most ${field.max}.`;
    }
  }

  validateHistoryRelationships(values, errors);
  validateWebSearchFields(values, errors);
  return errors;
}

function validateHistoryRelationships(
  values: FormValues,
  errors: Record<string, string>,
): void {
  const historyBudget = readNumber(values['agent.history_max_messages']);
  const preserveSpecialist = readNumber(values['agent.history_preserve_recent']);
  const preserveOrchestrator = readNumber(values['agent.orchestrator_history_preserve_recent']);

  if (
    historyBudget !== null &&
    preserveSpecialist !== null &&
    preserveSpecialist > historyBudget
  ) {
    errors['agent.history_preserve_recent'] =
      'Preserved specialist history must stay within the overall history budget.';
  }
  if (
    historyBudget !== null &&
    preserveOrchestrator !== null &&
    preserveOrchestrator > historyBudget
  ) {
    errors['agent.orchestrator_history_preserve_recent'] =
      'Preserved orchestrator history must stay within the overall history budget.';
  }
}

function readNumber(value: string | undefined): number | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function validateWebSearchFields(
  values: FormValues,
  errors: Record<string, string>,
): void {
  const provider = resolveWebSearchProvider(values);
  const providerDetails = getWebSearchProviderDetails(provider);
  const baseUrl = values['tools.web_search_base_url']?.trim();
  const apiKeyRef = values['tools.web_search_api_key_secret_ref']?.trim();

  if (baseUrl) {
    try {
      const parsed = new URL(baseUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        errors['tools.web_search_base_url'] =
          'Provider base URL must be a valid http or https URL. Clear the field to use the provider default endpoint.';
      }
    } catch {
      errors['tools.web_search_base_url'] =
        'Provider base URL must be a valid http or https URL. Clear the field to use the provider default endpoint.';
    }
  }

  if (apiKeyRef && !apiKeyRef.startsWith('secret:')) {
    errors['tools.web_search_api_key_secret_ref'] =
      'Provider API key secret ref must use a secret:NAME reference.';
  }

  if (providerDetails.requiresApiKey && !apiKeyRef) {
    errors['tools.web_search_api_key_secret_ref'] =
      `${providerDetails.label} requires a secret reference. Add one or switch the provider back to DuckDuckGo.`;
  }
}
