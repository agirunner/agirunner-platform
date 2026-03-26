import {
  Archive,
  Pencil,
  Plug,
  RotateCcw,
  ShieldCheck,
  Unplug,
  Undo2,
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
  onArchive(server: DashboardRemoteMcpServerRecord): void;
  onRestore(server: DashboardRemoteMcpServerRecord): void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Server</TableHead>
          <TableHead>Auth</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Specialists</TableHead>
          <TableHead className="w-[220px] text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.servers.map((server) => {
          const isBusy = props.busyServerId === server.id;
          const toolNames = summarizeDiscoveredToolNames(server.discovered_tools_snapshot);
          const isOauth = server.auth_mode === 'oauth';
          const connectLabel = server.oauth_connected ? 'Reconnect OAuth' : 'Connect OAuth';

          return (
            <TableRow key={server.id}>
              <TableCell className="align-top">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{server.name}</span>
                    <Badge variant="outline">{server.auth_mode}</Badge>
                    {server.is_archived ? <Badge variant="outline">Archived</Badge> : null}
                  </div>
                  <div className="text-xs text-muted">{server.description || 'No description provided.'}</div>
                  <div className="text-xs text-foreground">{server.endpoint_url}</div>
                  <div className="text-xs text-muted">
                    {toolNames.length > 0
                      ? `${toolNames.length} tool${toolNames.length === 1 ? '' : 's'} discovered: ${toolNames.join(', ')}`
                      : 'No discovered tools snapshot.'}
                  </div>
                </div>
              </TableCell>
              <TableCell className="align-top">
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
              <TableCell className="align-top">
                <div className="space-y-1 text-sm">
                  <div className="flex items-center gap-2">
                    <StatusBadge server={server} />
                    <span className="text-xs text-muted">
                      {formatRemoteMcpTransport(server.verified_transport)}
                    </span>
                  </div>
                  {server.verification_error ? (
                    <div className="text-xs text-red-600 dark:text-red-400">
                      {server.verification_error}
                    </div>
                  ) : null}
                </div>
              </TableCell>
              <TableCell className="align-top text-sm text-foreground">
                {server.assigned_specialist_count}
              </TableCell>
              <TableCell className="align-top">
                <div className="flex flex-wrap justify-end gap-2">
                  <IconActionButton
                    label="View tools"
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
                    disabled={isBusy || server.is_archived}
                    onClick={() => props.onReverify(server)}
                  >
                    <RotateCcw className="h-4 w-4" />
                  </IconActionButton>
                  {isOauth ? (
                    <IconActionButton
                      label={connectLabel}
                      disabled={isBusy || server.is_archived}
                      onClick={() => props.onConnectOAuth(server)}
                    >
                      <Plug className="h-4 w-4" />
                    </IconActionButton>
                  ) : null}
                  {isOauth && server.oauth_connected ? (
                    <IconActionButton
                      label="Disconnect OAuth"
                      disabled={isBusy || server.is_archived}
                      onClick={() => props.onDisconnectOAuth(server)}
                    >
                      <Unplug className="h-4 w-4" />
                    </IconActionButton>
                  ) : null}
                  {server.is_archived ? (
                    <IconActionButton
                      label="Restore"
                      disabled={isBusy}
                      onClick={() => props.onRestore(server)}
                    >
                      <Undo2 className="h-4 w-4" />
                    </IconActionButton>
                  ) : (
                    <IconActionButton
                      label="Archive"
                      disabled={isBusy}
                      onClick={() => props.onArchive(server)}
                    >
                      <Archive className="h-4 w-4" />
                    </IconActionButton>
                  )}
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function buildAuthLabel(server: DashboardRemoteMcpServerRecord): string {
  if (server.auth_mode === 'oauth') {
    return 'OAuth-backed remote server';
  }
  if (server.auth_mode === 'parameterized') {
    return 'Parameterized remote server';
  }
  return 'Unauthenticated remote server';
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
