import type { DashboardIntegrationRecord } from '../../lib/api.js';

export type IntegrationKind = DashboardIntegrationRecord['kind'];

export interface IntegrationHeaderDraft {
  id: string;
  key: string;
  value: string;
  hasStoredSecret: boolean;
}

export interface IntegrationFormState {
  kind: IntegrationKind;
  workflowId: string;
  subscriptions: string[];
  config: Record<string, string>;
  headers: IntegrationHeaderDraft[];
  labels: string[];
  configuredSecrets: Partial<Record<'secret' | 'webhook_url' | 'token', boolean>>;
}

export interface IntegrationSummaryField {
  label: string;
  value: string;
}

export interface IntegrationFieldDefinition {
  key: string;
  label: string;
  type: 'text' | 'url' | 'password';
  placeholder: string;
}

const SECRET_HEADER_SENTINEL = 'redacted://integration-header-secret';
let nextDraftId = 0;

export const KIND_LABELS: Record<IntegrationKind, string> = {
  webhook: 'Webhook',
  slack: 'Slack',
  otlp_http: 'OTLP HTTP',
  github_issues: 'GitHub Issues',
};

export const INTEGRATION_EVENT_OPTIONS = [
  'workflow.created',
  'workflow.completed',
  'workflow.failed',
  'workflow.cancelled',
  'workflow.gate_requested',
  'work_item.created',
  'work_item.updated',
  'task.created',
  'task.completed',
  'task.failed',
  'task.escalated',
  'task.awaiting_approval',
] as const;

const FIELDS_BY_KIND: Record<IntegrationKind, IntegrationFieldDefinition[]> = {
  webhook: [
    { key: 'url', label: 'Destination URL', type: 'url', placeholder: 'https://example.com/hooks' },
    { key: 'secret', label: 'Shared secret', type: 'password', placeholder: 'Leave blank to keep the stored secret' },
  ],
  slack: [
    { key: 'webhook_url', label: 'Webhook URL', type: 'password', placeholder: 'https://hooks.slack.com/services/...' },
    { key: 'channel', label: 'Channel', type: 'text', placeholder: '#alerts' },
    { key: 'username', label: 'Username', type: 'text', placeholder: 'Agirunner' },
    { key: 'icon_emoji', label: 'Icon emoji', type: 'text', placeholder: ':robot_face:' },
  ],
  otlp_http: [
    { key: 'endpoint', label: 'Endpoint', type: 'url', placeholder: 'https://collector.example.com/v1/traces' },
    { key: 'service_name', label: 'Service name', type: 'text', placeholder: 'agirunner.platform' },
  ],
  github_issues: [
    { key: 'owner', label: 'Repository owner', type: 'text', placeholder: 'agisnap' },
    { key: 'repo', label: 'Repository', type: 'text', placeholder: 'agirunner' },
    { key: 'api_base_url', label: 'API base URL', type: 'url', placeholder: 'https://api.github.com' },
    { key: 'token', label: 'Access token', type: 'password', placeholder: 'Leave blank to keep the stored token' },
  ],
};

export function fieldsForIntegrationKind(kind: IntegrationKind): IntegrationFieldDefinition[] {
  return FIELDS_BY_KIND[kind];
}

export function supportsHeaderEditor(kind: IntegrationKind): boolean {
  return kind === 'webhook' || kind === 'otlp_http';
}

export function supportsLabelEditor(kind: IntegrationKind): boolean {
  return kind === 'github_issues';
}

export function createIntegrationFormState(kind: IntegrationKind = 'webhook'): IntegrationFormState {
  return {
    kind,
    workflowId: '',
    subscriptions: [],
    config: {},
    headers: [],
    labels: [],
    configuredSecrets: {},
  };
}

export function hydrateIntegrationForm(integration: DashboardIntegrationRecord): IntegrationFormState {
  const config = asRecord(integration.config);
  return {
    kind: integration.kind,
    workflowId: integration.workflow_id ?? '',
    subscriptions: [...integration.subscriptions],
    config: {
      url: readString(config.url),
      secret: '',
      webhook_url: '',
      channel: readString(config.channel),
      username: readString(config.username),
      icon_emoji: readString(config.icon_emoji),
      endpoint: readString(config.endpoint),
      service_name: readString(config.service_name),
      owner: readString(config.owner),
      repo: readString(config.repo),
      api_base_url: readString(config.api_base_url),
      token: '',
    },
    headers: readHeaderDrafts(config.headers),
    labels: readStringList(config.labels),
    configuredSecrets: {
      ...(Boolean(config.secret_configured) ? { secret: true } : {}),
      ...(Boolean(config.webhook_url_configured) ? { webhook_url: true } : {}),
      ...(Boolean(config.token_configured) ? { token: true } : {}),
    },
  };
}

export function createHeaderDraft(
  key = '',
  value = '',
  hasStoredSecret = false,
): IntegrationHeaderDraft {
  nextDraftId += 1;
  return { id: `header-${nextDraftId}`, key, value, hasStoredSecret };
}

export function canSubmitIntegration(form: IntegrationFormState, mode: 'create' | 'edit'): boolean {
  if (form.kind === 'webhook') {
    return hasValue(form.config.url);
  }
  if (form.kind === 'slack') {
    return hasValue(form.config.webhook_url) || (mode === 'edit' && Boolean(form.configuredSecrets.webhook_url));
  }
  if (form.kind === 'otlp_http') {
    return hasValue(form.config.endpoint);
  }
  return (
    hasValue(form.config.owner) &&
    hasValue(form.config.repo) &&
    (hasValue(form.config.token) || (mode === 'edit' && Boolean(form.configuredSecrets.token)))
  );
}

export function buildCreateIntegrationPayload(form: IntegrationFormState) {
  return {
    kind: form.kind,
    ...(form.workflowId ? { workflow_id: form.workflowId } : {}),
    ...(form.subscriptions.length > 0 ? { subscriptions: form.subscriptions } : {}),
    config: buildConfigPayload(form),
  };
}

export function buildUpdateIntegrationPayload(form: IntegrationFormState) {
  return {
    subscriptions: form.subscriptions,
    config: buildConfigPayload(form),
  };
}

export function summarizeIntegrationConfig(integration: DashboardIntegrationRecord): IntegrationSummaryField[] {
  const config = asRecord(integration.config);
  if (integration.kind === 'webhook') {
    return [
      { label: 'Destination', value: readString(config.url) || 'Not configured' },
      { label: 'Headers', value: countLabel(asRecord(config.headers), 'header') },
      { label: 'Secret', value: Boolean(config.secret_configured) ? 'Configured' : 'Not configured' },
    ];
  }
  if (integration.kind === 'slack') {
    return [
      { label: 'Webhook', value: Boolean(config.webhook_url_configured) ? 'Configured' : 'Not configured' },
      { label: 'Channel', value: readString(config.channel) || 'Default' },
      { label: 'Identity', value: readString(config.username) || readString(config.icon_emoji) || 'Default sender' },
    ];
  }
  if (integration.kind === 'otlp_http') {
    return [
      { label: 'Endpoint', value: readString(config.endpoint) || 'Not configured' },
      { label: 'Service name', value: readString(config.service_name) || 'Default' },
      { label: 'Headers', value: countLabel(asRecord(config.headers), 'header') },
    ];
  }
  return [
    { label: 'Repository', value: describeRepo(config) },
    { label: 'API base URL', value: readString(config.api_base_url) || 'https://api.github.com' },
    { label: 'Labels', value: readStringList(config.labels).join(', ') || 'No default labels' },
    { label: 'Token', value: Boolean(config.token_configured) ? 'Configured' : 'Not configured' },
  ];
}

function buildConfigPayload(form: IntegrationFormState): Record<string, unknown> {
  const fields = fieldsForIntegrationKind(form.kind);
  const config: Record<string, unknown> = Object.fromEntries(
    fields
      .map((field) => [field.key, readOptionalField(form.config[field.key])])
      .filter((entry): entry is [string, string] => entry[1] !== undefined),
  );

  if (supportsHeaderEditor(form.kind)) {
    const headers = buildHeaderPayload(form.headers);
    if (headers && Object.keys(headers).length > 0) {
      config.headers = headers;
    }
  }

  if (supportsLabelEditor(form.kind) && form.labels.length > 0) {
    config.labels = [...form.labels];
  }

  return config;
}

function readOptionalField(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : undefined;
}

function buildHeaderPayload(headers: IntegrationHeaderDraft[]): Record<string, string> | undefined {
  const values = headers
    .map((header) => {
      const key = header.key.trim();
      if (!key) {
        return null;
      }
      const value = header.value.trim();
      if (value) {
        return [key, value] as const;
      }
      if (header.hasStoredSecret) {
        return [key, SECRET_HEADER_SENTINEL] as const;
      }
      return null;
    })
    .filter((entry): entry is readonly [string, string] => entry !== null);

  return values.length > 0 ? Object.fromEntries(values) : undefined;
}

function readHeaderDrafts(headers: unknown): IntegrationHeaderDraft[] {
  return Object.entries(asRecord(headers)).map(([key, value]) => {
    const text = readString(value);
    return createHeaderDraft(
      key,
      text.startsWith(SECRET_HEADER_SENTINEL) ? '' : text,
      text.startsWith(SECRET_HEADER_SENTINEL),
    );
  });
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function describeRepo(config: Record<string, unknown>): string {
  const owner = readString(config.owner);
  const repo = readString(config.repo);
  return owner && repo ? `${owner}/${repo}` : 'Not configured';
}

function countLabel(record: Record<string, unknown>, noun: string): string {
  const count = Object.keys(record).length;
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function hasValue(value: string | undefined): boolean {
  return (value?.trim().length ?? 0) > 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
