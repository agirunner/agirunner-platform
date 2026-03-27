import type {
  DashboardRemoteMcpServerCreateInput,
  DashboardRemoteMcpServerParameterInput,
  DashboardRemoteMcpServerParameterRecord,
  DashboardRemoteMcpServerRecord,
  DashboardRemoteMcpServerUpdateInput,
} from '../../lib/api.js';

export const REMOTE_MCP_STORED_SECRET_VALUE = 'redacted://remote-mcp-secret';
export const DEFAULT_REMOTE_MCP_CALL_TIMEOUT_SECONDS = 300;

export interface RemoteMcpParameterFormState {
  id: string;
  placement: DashboardRemoteMcpServerParameterInput['placement'];
  key: string;
  valueKind: DashboardRemoteMcpServerParameterInput['valueKind'];
  value: string;
  hasStoredSecret: boolean;
}

export interface RemoteMcpServerFormState {
  name: string;
  description: string;
  endpointUrl: string;
  callTimeoutSeconds: string;
  authMode: DashboardRemoteMcpServerCreateInput['authMode'];
  enabledByDefaultForNewSpecialists: boolean;
  grantToAllExistingSpecialists: boolean;
  parameters: RemoteMcpParameterFormState[];
}

export interface RemoteMcpServerStats {
  total: number;
  oauthConnected: number;
}

export function createRemoteMcpServerForm(
  server?: DashboardRemoteMcpServerRecord | null,
): RemoteMcpServerFormState {
  return {
    name: server?.name ?? '',
    description: server?.description ?? '',
    endpointUrl: server?.endpoint_url ?? '',
    callTimeoutSeconds: String(server?.call_timeout_seconds ?? DEFAULT_REMOTE_MCP_CALL_TIMEOUT_SECONDS),
    authMode: server?.auth_mode ?? 'none',
    enabledByDefaultForNewSpecialists:
      server?.enabled_by_default_for_new_specialists ?? false,
    grantToAllExistingSpecialists: false,
    parameters:
      server?.parameters.map(createParameterFormFromRecord) ?? [createRemoteMcpParameterForm()],
  };
}

export function createRemoteMcpParameterForm(): RemoteMcpParameterFormState {
  return {
    id: crypto.randomUUID(),
    placement: 'query',
    key: '',
    valueKind: 'static',
    value: '',
    hasStoredSecret: false,
  };
}

export function buildRemoteMcpCreatePayload(
  form: RemoteMcpServerFormState,
): DashboardRemoteMcpServerCreateInput {
  return {
    name: form.name.trim(),
    description: form.description.trim(),
    endpointUrl: form.endpointUrl.trim(),
    callTimeoutSeconds: parseCallTimeoutSeconds(form.callTimeoutSeconds),
    authMode: form.authMode,
    enabledByDefaultForNewSpecialists: form.enabledByDefaultForNewSpecialists,
    grantToAllExistingSpecialists: form.grantToAllExistingSpecialists,
    parameters: buildRemoteMcpParameters(form.parameters),
  };
}

export function buildRemoteMcpUpdatePayload(
  form: RemoteMcpServerFormState,
): DashboardRemoteMcpServerUpdateInput {
  return {
    name: form.name.trim(),
    description: form.description.trim(),
    endpointUrl: form.endpointUrl.trim(),
    callTimeoutSeconds: parseCallTimeoutSeconds(form.callTimeoutSeconds),
    authMode: form.authMode,
    enabledByDefaultForNewSpecialists: form.enabledByDefaultForNewSpecialists,
    parameters: buildRemoteMcpParameters(form.parameters),
  };
}

export function buildRemoteMcpServerStats(
  servers: DashboardRemoteMcpServerRecord[],
): RemoteMcpServerStats {
  return servers.reduce(
    (summary, server) => ({
      total: summary.total + 1,
      oauthConnected:
        summary.oauthConnected
        + (server.auth_mode === 'oauth' && server.oauth_connected ? 1 : 0),
    }),
    {
      total: 0,
      oauthConnected: 0,
    },
  );
}

export function sortRemoteMcpServers(
  servers: DashboardRemoteMcpServerRecord[],
): DashboardRemoteMcpServerRecord[] {
  return [...servers].sort((left, right) => left.name.localeCompare(right.name));
}

export function summarizeDiscoveredToolNames(
  tools: Array<Record<string, unknown>>,
): string[] {
  const names = tools.flatMap((tool) => {
    const originalName = readString(tool.original_name);
    if (originalName) {
      return [originalName];
    }
    const name = readString(tool.name);
    return name ? [name] : [];
  });
  return Array.from(new Set(names));
}

export function formatRemoteMcpTransport(
  transport: DashboardRemoteMcpServerRecord['verified_transport'],
): string {
  if (transport === 'streamable_http') {
    return 'Streamable HTTP';
  }
  if (transport === 'http_sse_compat') {
    return 'HTTP + SSE compatibility';
  }
  return 'Not verified';
}

function createParameterFormFromRecord(
  parameter: DashboardRemoteMcpServerParameterRecord,
): RemoteMcpParameterFormState {
  return {
    id: parameter.id,
    placement: parameter.placement,
    key: parameter.key,
    valueKind: parameter.value_kind,
    value:
      parameter.value_kind === 'secret'
      && (parameter.has_stored_secret || parameter.value === REMOTE_MCP_STORED_SECRET_VALUE)
        ? ''
        : parameter.value,
    hasStoredSecret:
      parameter.value_kind === 'secret'
      && (parameter.has_stored_secret || parameter.value === REMOTE_MCP_STORED_SECRET_VALUE),
  };
}

function buildRemoteMcpParameters(
  parameters: RemoteMcpParameterFormState[],
): DashboardRemoteMcpServerParameterInput[] {
  return parameters.flatMap((parameter) => {
    const key = parameter.key.trim();
    if (!key) {
      return [];
    }
    const normalizedValue = normalizeParameterValue(parameter);
    if (!normalizedValue) {
      return [];
    }
    return [{
      placement: parameter.placement,
      key,
      valueKind: parameter.valueKind,
      value: normalizedValue,
    }];
  });
}

function normalizeParameterValue(parameter: RemoteMcpParameterFormState): string | null {
  const value = parameter.value.trim();
  if (parameter.valueKind === 'secret') {
    if (value.length > 0) {
      return value;
    }
    return parameter.hasStoredSecret ? REMOTE_MCP_STORED_SECRET_VALUE : null;
  }
  return value.length > 0 ? value : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function parseCallTimeoutSeconds(value: string): number {
  const normalized = value.trim();
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('Call timeout must be a positive whole number of seconds.');
  }
  return parsed;
}
