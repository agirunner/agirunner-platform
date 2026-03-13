export interface CreateWebhookFormState {
  url: string;
  event_types: string[];
  secret: string;
}

export interface WebhookSummaryRecord {
  is_active: boolean;
  event_types: string[];
}

export interface WebhookValidationResult {
  fieldErrors: {
    url?: string;
    secret?: string;
  };
  issues: string[];
  isValid: boolean;
}

export function validateWebhookForm(
  form: CreateWebhookFormState,
): WebhookValidationResult {
  const fieldErrors: WebhookValidationResult['fieldErrors'] = {};

  if (!form.url.trim()) {
    fieldErrors.url = 'Enter a destination URL.';
  } else if (!isSupportedUrl(form.url.trim())) {
    fieldErrors.url = 'Enter a valid http:// or https:// URL.';
  }

  if (form.secret.trim() && form.secret.trim().length < 8) {
    fieldErrors.secret = 'Secrets must be at least 8 characters or left blank.';
  }

  const issues = Object.values(fieldErrors);
  return {
    fieldErrors,
    issues,
    isValid: issues.length === 0,
  };
}

export function describeWebhookCoverage(eventTypes: string[]): string {
  if (eventTypes.length === 0) {
    return 'All supported events';
  }
  if (eventTypes.length === 1) {
    return `1 event filter`;
  }
  return `${eventTypes.length} event filters`;
}

export function summarizeWebhookCollection(
  webhooks: WebhookSummaryRecord[],
): Array<{ label: string; value: string; detail: string }> {
  const total = webhooks.length;
  const active = webhooks.filter((webhook) => webhook.is_active).length;
  const filtered = webhooks.filter((webhook) => webhook.event_types.length > 0).length;
  const defaultCoverage = total - filtered;

  return [
    {
      label: 'Configured endpoints',
      value: String(total),
      detail: total === 1 ? '1 outbound destination configured' : `${total} outbound destinations configured`,
    },
    {
      label: 'Delivery posture',
      value: `${active} active`,
      detail: `${total - active} paused endpoint${total - active === 1 ? '' : 's'}`,
    },
    {
      label: 'Coverage',
      value: filtered > 0 ? `${filtered} filtered` : 'Default coverage',
      detail:
        defaultCoverage > 0
          ? `${defaultCoverage} endpoint${defaultCoverage === 1 ? ' receives' : 's receive'} all supported events`
          : 'Every endpoint uses explicit event filters',
    },
  ];
}

function isSupportedUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
