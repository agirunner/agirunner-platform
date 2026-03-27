import { Fragment } from 'react';
import {
  Pencil,
  Plug,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Unplug,
  Wrench,
} from 'lucide-react';

import { Badge } from '../../components/ui/badge.js';
import { IconActionButton } from '../../components/ui/icon-action-button.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table.js';
import type { DashboardRemoteMcpServerRecord } from '../../lib/api.js';
import {
  formatDiscoveredCapabilitySummary,
  formatRemoteMcpTransport,
  summarizeDiscoveredToolNames,
} from './mcp-page.support.js';

export function McpPageTable(props: {
  servers: DashboardRemoteMcpServerRecord[];
  busyServerId: string | null;
  onViewTools(server: DashboardRemoteMcpServerRecord): void;
  onEdit(server: DashboardRemoteMcpServerRecord): void;
  onReverify(server: DashboardRemoteMcpServerRecord): void;
  onConnectOAuth(server: DashboardRemoteMcpServerRecord): void;
  onDisconnectOAuth(server: DashboardRemoteMcpServerRecord): void;
  onDelete(server: DashboardRemoteMcpServerRecord): void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Server</TableHead>
          <TableHead className="w-[220px]">Auth</TableHead>
          <TableHead className="w-[150px]">Status</TableHead>
          <TableHead className="w-[190px]">Transport</TableHead>
          <TableHead>Specialists</TableHead>
          <TableHead className="w-[260px] text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.servers.map((server) => {
          const isBusy = props.busyServerId === server.id;
          const toolNames = summarizeDiscoveredToolNames(server.discovered_tools_snapshot);
          const isOauth = server.auth_mode === 'oauth';
          const connectLabel = server.oauth_connected ? 'Reconnect OAuth' : 'Connect OAuth';

          return (
            <Fragment key={server.id}>
              <TableRow>
                <TableCell className="align-middle">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-foreground">{server.name}</span>
                      <Badge variant="outline">{server.auth_mode}</Badge>
                    </div>
                    <div className="text-xs text-muted">{server.description || 'No description provided.'}</div>
                    <div className="text-xs text-foreground">{server.endpoint_url}</div>
                    <div className="text-xs text-muted">Call timeout: {server.call_timeout_seconds}s</div>
                  </div>
                </TableCell>
                <TableCell className="align-middle">
                  <div className="space-y-1 text-sm">
                    <div className="font-medium text-foreground">{buildAuthLabel(server)}</div>
                    <div className="text-xs text-muted">
                      Default on new specialists:{' '}
                      {server.enabled_by_default_for_new_specialists ? 'On' : 'Off'}
                    </div>
                    {isOauth ? (
                      <div className="text-xs text-muted">
                        {server.oauth_connected
                          ? server.oauth_needs_reauth
                            ? 'OAuth needs reconnect'
                            : 'OAuth connected'
                          : 'OAuth not connected'}
                      </div>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="align-middle">
                  <div className="space-y-1 text-sm">
                    <div className="flex items-center gap-2">
                      <StatusBadge server={server} />
                    </div>
                    {server.verification_error ? (
                      <div className="text-xs text-red-600 dark:text-red-400">
                        {server.verification_error}
                      </div>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="align-middle text-sm text-foreground">
                  <span className="whitespace-nowrap">
                    {formatRemoteMcpTransport(server.verified_transport)}
                  </span>
                </TableCell>
                <TableCell className="align-middle text-sm text-foreground">
                  {server.assigned_specialist_count}
                </TableCell>
                <TableCell className="align-middle">
                  <div className="flex flex-nowrap justify-end gap-2 whitespace-nowrap">
                    <IconActionButton
                      label="View capabilities"
                      disabled={isBusy}
                      onClick={() => props.onViewTools(server)}
                    >
                      <Wrench className="h-4 w-4" />
                    </IconActionButton>
                    <IconActionButton
                      label="Edit"
                      disabled={isBusy}
                      onClick={() => props.onEdit(server)}
                    >
                      <Pencil className="h-4 w-4" />
                    </IconActionButton>
                    <IconActionButton
                      label="Reverify"
                      disabled={isBusy}
                      onClick={() => props.onReverify(server)}
                    >
                      <RotateCcw className="h-4 w-4" />
                    </IconActionButton>
                    {isOauth ? (
                      <IconActionButton
                        label={connectLabel}
                        disabled={isBusy}
                        onClick={() => props.onConnectOAuth(server)}
                      >
                        <Plug className="h-4 w-4" />
                      </IconActionButton>
                    ) : null}
                    {isOauth && server.oauth_connected ? (
                      <IconActionButton
                        label="Disconnect OAuth"
                        disabled={isBusy}
                        onClick={() => props.onDisconnectOAuth(server)}
                      >
                        <Unplug className="h-4 w-4" />
                      </IconActionButton>
                    ) : null}
                    <IconActionButton
                      label="Delete"
                      disabled={isBusy}
                      onClick={() => props.onDelete(server)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </IconActionButton>
                  </div>
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell colSpan={6} className="bg-border/10">
                  <div className="space-y-2 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
                      Capabilities summary
                    </div>
                    <div className="rounded-lg border border-border/70 bg-background/80 p-3 text-sm">
                      <div className="text-muted">
                        {formatDiscoveredCapabilitySummary(server)}
                      </div>
                      <div className="mt-2 text-muted">
                        {toolNames.length > 0
                          ? `${toolNames.length} tool${toolNames.length === 1 ? '' : 's'} discovered: ${toolNames.join(', ')}`
                          : 'No discovered tools snapshot.'}
                      </div>
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}

function buildAuthLabel(server: DashboardRemoteMcpServerRecord): string {
  if (server.auth_mode === 'oauth') {
    return 'OAuth';
  }
  if (server.auth_mode === 'parameterized' || server.parameters.length > 0) {
    return 'Connection parameters';
  }
  return 'No additional auth';
}

function StatusBadge(props: { server: DashboardRemoteMcpServerRecord }) {
  if (props.server.verification_status === 'verified') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
        <ShieldCheck className="h-3.5 w-3.5" />
        Verified
      </span>
    );
  }
  if (props.server.verification_status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 dark:text-red-300">
        Verification failed
      </span>
    );
  }
  return <span className="text-xs font-medium text-muted">Not verified</span>;
}
