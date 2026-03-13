import type {
  DashboardScheduledWorkItemTriggerRecord,
  DashboardWebhookWorkItemTriggerRecord,
} from '../../lib/api.js';

export interface WebhookTriggerFormState {
  name: string;
  source: string;
  projectId: string;
  workflowId: string;
  eventHeader: string;
  eventTypes: string;
  signatureHeader: string;
  signatureMode: 'hmac_sha256' | 'shared_secret';
  secret: string;
  secretConfigured: boolean;
  fieldMappings: string;
  defaults: string;
  isActive: boolean;
}

export interface WebhookTriggerValidation {
  isValid: boolean;
  issues: string[];
  fieldErrors: Record<string, string>;
}

export function createWebhookTriggerFormState(): WebhookTriggerFormState {
  return {
    name: '',
    source: '',
    projectId: '',
    workflowId: '',
    eventHeader: '',
    eventTypes: '',
    signatureHeader: 'x-hub-signature-256',
    signatureMode: 'hmac_sha256',
    secret: '',
    secretConfigured: false,
    fieldMappings: '{}',
    defaults: '{}',
    isActive: true,
  };
}

export function hydrateWebhookTriggerForm(
  trigger: DashboardWebhookWorkItemTriggerRecord,
): WebhookTriggerFormState {
  return {
    name: trigger.name,
    source: trigger.source,
    projectId: trigger.project_id ?? '',
    workflowId: trigger.workflow_id,
    eventHeader: trigger.event_header ?? '',
    eventTypes: (trigger.event_types ?? []).join(', '),
    signatureHeader: trigger.signature_header,
    signatureMode: trigger.signature_mode,
    secret: '',
    secretConfigured: Boolean(trigger.secret_configured),
    fieldMappings: JSON.stringify(trigger.field_mappings ?? {}, null, 2),
    defaults: JSON.stringify(trigger.defaults ?? {}, null, 2),
    isActive: trigger.is_active,
  };
}

export function validateWebhookTriggerForm(
  form: WebhookTriggerFormState,
  mode: 'create' | 'edit',
): WebhookTriggerValidation {
  const issues: string[] = [];
  const fieldErrors: Record<string, string> = {};
  const eventTypes = splitEventTypes(form.eventTypes);

  if (!form.name.trim()) {
    addIssue(fieldErrors, issues, 'name', 'Add a trigger name.');
  }
  if (!form.source.trim()) {
    addIssue(fieldErrors, issues, 'source', 'Add a source identifier.');
  } else if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)+$/i.test(form.source.trim())) {
    addIssue(
      fieldErrors,
      issues,
      'source',
      'Use a namespaced source such as github.webhook or jira.issue.created.',
    );
  }
  if (!form.workflowId) {
    addIssue(fieldErrors, issues, 'workflowId', 'Select a target workflow.');
  }
  if (!form.signatureHeader.trim()) {
    addIssue(fieldErrors, issues, 'signatureHeader', 'Add the header that carries the request signature.');
  } else if (/\s/.test(form.signatureHeader.trim())) {
    addIssue(fieldErrors, issues, 'signatureHeader', 'Signature headers cannot contain spaces.');
  }
  if (mode === 'create' && !form.secret.trim()) {
    addIssue(fieldErrors, issues, 'secret', 'Add a shared secret for new triggers.');
  }
  if (eventTypes.length > 0 && !form.eventHeader.trim()) {
    addIssue(fieldErrors, issues, 'eventHeader', 'Add an event header when filtering by event type.');
  }
  if (hasDuplicateValues(eventTypes)) {
    addIssue(fieldErrors, issues, 'eventTypes', 'Event types must be unique.');
  }
  validateJsonObjectField(form.fieldMappings, 'fieldMappings', 'Field mappings', fieldErrors, issues);
  validateJsonObjectField(form.defaults, 'defaults', 'Defaults', fieldErrors, issues);

  return { isValid: issues.length === 0, issues, fieldErrors };
}

export function buildWebhookTriggerCreatePayload(form: WebhookTriggerFormState) {
  const eventTypes = splitEventTypes(form.eventTypes);
  return {
    name: form.name.trim(),
    source: form.source.trim(),
    ...(form.projectId ? { project_id: form.projectId } : {}),
    workflow_id: form.workflowId,
    ...(form.eventHeader.trim() ? { event_header: form.eventHeader.trim() } : {}),
    ...(eventTypes.length > 0 ? { event_types: eventTypes } : {}),
    signature_header: form.signatureHeader.trim(),
    signature_mode: form.signatureMode,
    secret: form.secret,
    field_mappings: parseJsonOrEmpty(form.fieldMappings),
    defaults: parseJsonOrEmpty(form.defaults),
    is_active: form.isActive,
  };
}

export function buildWebhookTriggerUpdatePayload(form: WebhookTriggerFormState) {
  const eventTypes = splitEventTypes(form.eventTypes);
  return {
    name: form.name.trim(),
    source: form.source.trim(),
    project_id: form.projectId || null,
    workflow_id: form.workflowId,
    event_header: form.eventHeader.trim() || null,
    event_types: eventTypes,
    signature_header: form.signatureHeader.trim(),
    signature_mode: form.signatureMode,
    ...(form.secret.trim() ? { secret: form.secret } : {}),
    field_mappings: parseJsonOrEmpty(form.fieldMappings),
    defaults: parseJsonOrEmpty(form.defaults),
    is_active: form.isActive,
  };
}

function parseJsonOrEmpty(value: string): Record<string, unknown> {
  try {
    return JSON.parse(value.trim() || '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

function splitEventTypes(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function hasDuplicateValues(values: string[]): boolean {
  return new Set(values.map((value) => value.toLowerCase())).size !== values.length;
}

function validateJsonObjectField(
  value: string,
  field: 'fieldMappings' | 'defaults',
  label: string,
  fieldErrors: Record<string, string>,
  issues: string[],
): void {
  if (!value.trim()) {
    return;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isPlainObject(parsed)) {
      addIssue(fieldErrors, issues, field, `${label} must be a JSON object.`);
    }
  } catch {
    addIssue(fieldErrors, issues, field, `${label} must be valid JSON.`);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function addIssue(
  fieldErrors: Record<string, string>,
  issues: string[],
  field: string,
  message: string,
): void {
  fieldErrors[field] = message;
  issues.push(message);
}

export interface TriggerOverviewSummaryCard {
  label: string;
  value: string;
  detail: string;
}

export interface TriggerOperatorFocusPacket {
  title: string;
  value: string;
  detail: string;
}

export function summarizeTriggerOverview(
  scheduled: DashboardScheduledWorkItemTriggerRecord[],
  webhooks: DashboardWebhookWorkItemTriggerRecord[],
): TriggerOverviewSummaryCard[] {
  const dueScheduled = scheduled.filter((trigger) => describeScheduledTriggerHealth(trigger).label === 'Due').length;
  const disabledScheduled = scheduled.filter((trigger) => !trigger.is_active).length;
  const activeWebhookCount = webhooks.filter((trigger) => trigger.is_active).length;
  const disabledWebhookCount = webhooks.length - activeWebhookCount;

  return [
    {
      label: 'Automation coverage',
      value: scheduled.length > 0 ? `${scheduled.length} rules` : 'No schedules',
      detail:
        scheduled.length === 0
          ? 'No recurring work-item rules configured yet'
          : `${scheduled.filter((trigger) => trigger.is_active).length} active recurring rule${scheduled.filter((trigger) => trigger.is_active).length === 1 ? '' : 's'} across project automation`,
    },
    {
      label: 'Recovery pressure',
      value: dueScheduled + disabledScheduled + disabledWebhookCount > 0 ? `${dueScheduled + disabledScheduled + disabledWebhookCount} need review` : 'Healthy',
      detail:
        dueScheduled > 0
          ? `${dueScheduled} scheduled rule${dueScheduled === 1 ? '' : 's'} should fire now or recover`
          : disabledScheduled + disabledWebhookCount > 0
            ? `${disabledScheduled + disabledWebhookCount} automation rule${disabledScheduled + disabledWebhookCount === 1 ? '' : 's'} are paused and need operator confirmation`
            : 'No scheduled or inbound automation needs recovery',
    },
    {
      label: 'Webhook intake',
      value: webhooks.length > 0 ? `${activeWebhookCount}/${webhooks.length} live` : 'No webhooks',
      detail:
        webhooks.length === 0
          ? 'No inbound webhook triggers configured'
          : `${activeWebhookCount} active inbound webhook trigger${activeWebhookCount === 1 ? '' : 's'}${disabledWebhookCount > 0 ? `, ${disabledWebhookCount} paused` : ''}`,
    },
  ];
}

export function buildTriggerOperatorFocus(
  scheduled: DashboardScheduledWorkItemTriggerRecord[],
  webhooks: DashboardWebhookWorkItemTriggerRecord[],
): TriggerOperatorFocusPacket {
  const dueScheduled = scheduled.filter((trigger) => describeScheduledTriggerHealth(trigger).label === 'Due').length;
  const disabledScheduled = scheduled.filter((trigger) => !trigger.is_active).length;
  const disabledWebhooks = webhooks.filter((trigger) => !trigger.is_active).length;

  if (dueScheduled > 0) {
    return {
      title: 'Recover overdue automation',
      value: `${dueScheduled} due now`,
      detail: 'Open the owning project automation settings and confirm the recurring work-item rule can fire immediately.',
    };
  }
  if (disabledScheduled + disabledWebhooks > 0) {
    return {
      title: 'Review paused automation',
      value: `${disabledScheduled + disabledWebhooks} paused`,
      detail: 'Re-enable schedules or inbound hooks only after validating cadence, board target, and source wiring.',
    };
  }
  return {
    title: 'Automation posture is healthy',
    value: 'No recovery queue',
    detail: 'Recurring and inbound automation are active. Use the owning project settings if scope or cadence changes.',
  };
}

export function describeScheduledTriggerHealth(trigger: DashboardScheduledWorkItemTriggerRecord) {
  if (!trigger.is_active) {
    return { label: 'Disabled', variant: 'secondary' as const };
  }
  if (Date.parse(trigger.next_fire_at) <= Date.now()) {
    return { label: 'Due', variant: 'warning' as const };
  }
  return { label: 'Scheduled', variant: 'success' as const };
}

export function describeScheduledTriggerPacket(trigger: DashboardScheduledWorkItemTriggerRecord) {
  return {
    cadence: formatCadence(trigger.cadence_minutes),
    nextRun: formatDateTime(trigger.next_fire_at),
    source: trigger.source || 'project.schedule',
    nextAction: describeScheduledTriggerNextAction(trigger),
  };
}

export function describeWebhookTriggerPacket(trigger: DashboardWebhookWorkItemTriggerRecord) {
  const activity = describeWebhookTriggerActivity(trigger);
  return {
    source: trigger.source || 'webhook',
    mode: trigger.signature_mode || 'unsigned',
    activity: activity.label,
    nextAction: describeWebhookTriggerNextAction(trigger),
  };
}

export function describeWebhookTriggerActivity(trigger: DashboardWebhookWorkItemTriggerRecord) {
  return trigger.is_active
    ? { label: 'Active', variant: 'success' as const }
    : { label: 'Disabled', variant: 'secondary' as const };
}

export function describeScheduledTriggerNextAction(
  trigger: DashboardScheduledWorkItemTriggerRecord,
): string {
  const health = describeScheduledTriggerHealth(trigger);
  if (health.label === 'Due') {
    return 'Open the owning project and confirm the recurring work-item rule can fire now.';
  }
  if (health.label === 'Disabled') {
    return 'Re-enable only after confirming cadence, board target, and default routing in project automation.';
  }
  return 'Monitor the next run and adjust cadence or defaults from project automation if the work changed.';
}

export function describeWebhookTriggerNextAction(
  trigger: DashboardWebhookWorkItemTriggerRecord,
): string {
  if (!trigger.is_active) {
    return 'Re-enable only after validating signature mode, headers, and source-system wiring.';
  }
  return 'Keep the source system wired to this intake rule and open the owning project if delivery stops.';
}

export function formatCadence(minutes: number): string {
  if (minutes < 60) return `Every ${minutes} min`;
  if (minutes % 60 === 0) return `Every ${minutes / 60} hr`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `Every ${hours} hr ${remainder} min`;
}

export function formatDateTime(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? value : new Date(timestamp).toLocaleString();
}
