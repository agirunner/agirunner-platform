export interface CreateWebhookFormState {
  url: string;
  event_types: string[];
  secret: string;
}

export interface WebhookRecord {
  id: string;
  url: string;
  event_types: string[];
  is_active: boolean;
  created_at?: string;
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

export interface WebhookEventGroup {
  key: string;
  label: string;
  description: string;
  eventTypes: string[];
}

export interface WebhookSelectionSummaryCard {
  label: string;
  value: string;
  detail: string;
}

export interface WebhookOperatorFocus {
  heading: string;
  summary: string;
  nextAction: string;
  packets: WebhookSelectionSummaryCard[];
}

export interface WebhookInspectPacket {
  label: string;
  value: string;
  detail: string;
}

export const WEBHOOK_EVENT_GROUPS: WebhookEventGroup[] = [
  {
    key: 'workflow',
    label: 'Workflow lifecycle',
    description: 'Launch, completion, failure, cancellation, and gate-request notifications.',
    eventTypes: [
      'workflow.created',
      'workflow.completed',
      'workflow.failed',
      'workflow.cancelled',
      'workflow.gate_requested',
    ],
  },
  {
    key: 'work_item',
    label: 'Work-item changes',
    description: 'Creation and update events for orchestrated work items.',
    eventTypes: ['work_item.created', 'work_item.updated'],
  },
  {
    key: 'task',
    label: 'Task execution',
    description: 'Task creation, completion, failure, escalation, and approval wait states.',
    eventTypes: [
      'task.created',
      'task.completed',
      'task.failed',
      'task.escalated',
      'task.awaiting_approval',
    ],
  },
];

export function validateWebhookForm(form: CreateWebhookFormState): WebhookValidationResult {
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
      detail:
        total === 1
          ? '1 outbound destination configured'
          : `${total} outbound destinations configured`,
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

export function summarizeWebhookSelection(eventTypes: string[]): WebhookSelectionSummaryCard[] {
  const selectedGroups = WEBHOOK_EVENT_GROUPS.filter((group) =>
    group.eventTypes.some((eventType) => eventTypes.includes(eventType)),
  );

  return [
    {
      label: 'Coverage mode',
      value: eventTypes.length === 0 ? 'All events' : 'Filtered delivery',
      detail:
        eventTypes.length === 0
          ? 'Leaving every event clear sends all supported webhook events.'
          : 'Only the selected event families and events will be delivered.',
    },
    {
      label: 'Selected families',
      value: String(selectedGroups.length),
      detail:
        selectedGroups.length === 0
          ? 'All event families are currently included.'
          : `${selectedGroups.map((group) => group.label).join(', ')}.`,
    },
    {
      label: 'Selected events',
      value: eventTypes.length === 0 ? 'All supported' : String(eventTypes.length),
      detail: describeWebhookCoverage(eventTypes),
    },
  ];
}

export function createWebhookFormState(
  webhook?: Pick<WebhookRecord, 'url' | 'event_types'> | null,
): CreateWebhookFormState {
  return {
    url: webhook?.url ?? '',
    event_types: [...(webhook?.event_types ?? [])],
    secret: '',
  };
}

export function buildWebhookOperatorFocus(webhooks: WebhookSummaryRecord[]): WebhookOperatorFocus {
  const total = webhooks.length;
  const active = webhooks.filter((webhook) => webhook.is_active).length;
  const paused = total - active;
  const broadCoverage = webhooks.filter((webhook) => webhook.event_types.length === 0).length;
  const filtered = total - broadCoverage;

  if (total === 0) {
    return {
      heading: 'No outbound destinations are live yet',
      summary:
        'Create the first outbound webhook to send platform events into downstream operator systems, incident workflows, or external automation.',
      nextAction:
        'Add one endpoint with a known signing secret, inspect the event scope, and validate the receiver before launch.',
      packets: summarizeWebhookCollection(webhooks),
    };
  }

  if (paused > 0) {
    return {
      heading: 'Delivery posture needs review',
      summary:
        paused === 1
          ? 'One endpoint is paused, which can silently block notifications the operator expects to receive.'
          : `${paused} endpoints are paused, which can silently block notifications the operator expects to receive.`,
      nextAction:
        'Inspect paused endpoints first. Reactivate anything still in service, then delete stale destinations so the catalog reflects reality.',
      packets: summarizeWebhookCollection(webhooks),
    };
  }

  if (broadCoverage > 0) {
    return {
      heading: 'Review broad event delivery before launch',
      summary:
        broadCoverage === 1
          ? 'One endpoint receives every supported event. That is valid, but it should be an explicit operator choice.'
          : `${broadCoverage} endpoints receive every supported event. That is valid, but it should be an explicit operator choice.`,
      nextAction:
        'Inspect broad-coverage endpoints and narrow the filters when the downstream system only needs a subset of workflow or task events.',
      packets: summarizeWebhookCollection(webhooks),
    };
  }

  return {
    heading: 'Outbound webhook coverage is configured',
    summary:
      filtered === 1
        ? 'The configured endpoint is scoped to explicit event filters and ready for operator review.'
        : `${filtered} configured endpoints are scoped to explicit event filters and ready for operator review.`,
    nextAction:
      'Open each endpoint, confirm the URL, store the signing secret out-of-band, and verify the receiver returns 2xx for the selected events.',
    packets: summarizeWebhookCollection(webhooks),
  };
}

export function buildWebhookInspectPackets(
  webhook: Pick<WebhookRecord, 'event_types' | 'is_active' | 'created_at'>,
): WebhookInspectPacket[] {
  const selectedFamilies = WEBHOOK_EVENT_GROUPS.filter((group) =>
    group.eventTypes.some((eventType) => webhook.event_types.includes(eventType)),
  );

  return [
    {
      label: 'Delivery state',
      value: webhook.is_active ? 'Active delivery' : 'Paused delivery',
      detail: webhook.is_active
        ? 'The platform can deliver matching outbound events to this endpoint now.'
        : 'The endpoint is stored but will not receive outbound events until it is re-enabled.',
    },
    {
      label: 'Coverage',
      value: describeWebhookCoverage(webhook.event_types),
      detail:
        webhook.event_types.length === 0
          ? 'Every supported webhook event can be delivered to this endpoint.'
          : `${selectedFamilies.length} event famil${selectedFamilies.length === 1 ? 'y is' : 'ies are'} explicitly selected.`,
    },
    {
      label: 'Created',
      value: webhook.created_at ? 'Timestamp recorded' : 'Timestamp unavailable',
      detail: webhook.created_at
        ? 'Use the created timestamp to confirm whether this endpoint predates the current workflow rollout.'
        : 'This record does not include a created timestamp.',
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
