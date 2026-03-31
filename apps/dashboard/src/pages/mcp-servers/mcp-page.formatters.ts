import type { DashboardRemoteMcpServerRecord } from '../../lib/api.js';

export interface RemoteMcpServerStats {
  total: number;
  oauthConnected: number;
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

export function formatRemoteMcpTransportPreference(
  preference: DashboardRemoteMcpServerRecord['transport_preference'] | 'auto',
): string {
  if (preference === 'streamable_http') {
    return 'Streamable HTTP only';
  }
  if (preference === 'http_sse_compat') {
    return 'HTTP + SSE compatibility only';
  }
  return 'Automatic negotiation';
}

export function formatDiscoveredCapabilitySummary(
  server: Pick<
    DashboardRemoteMcpServerRecord,
    | 'discovered_tool_count'
    | 'discovered_resource_count'
    | 'discovered_prompt_count'
    | 'verified_capability_summary'
  >,
): string {
  const toolCount = readCapabilityCount(
    server.discovered_tool_count,
    server.verified_capability_summary?.tool_count,
  );
  const resourceCount = readCapabilityCount(
    server.discovered_resource_count,
    server.verified_capability_summary?.resource_count,
  );
  const promptCount = readCapabilityCount(
    server.discovered_prompt_count,
    server.verified_capability_summary?.prompt_count,
  );
  return `${toolCount} tool${toolCount === 1 ? '' : 's'}, ${resourceCount} resource${resourceCount === 1 ? '' : 's'}, ${promptCount} prompt${promptCount === 1 ? '' : 's'}`;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readCapabilityCount(primary: unknown, fallback: unknown): number {
  if (typeof primary === 'number' && Number.isInteger(primary) && primary >= 0) {
    return primary;
  }
  return typeof fallback === 'number' && Number.isInteger(fallback) && fallback >= 0 ? fallback : 0;
}
