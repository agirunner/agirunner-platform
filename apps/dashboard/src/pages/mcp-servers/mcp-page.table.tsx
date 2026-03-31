import { Fragment, useState, type MouseEvent } from 'react';
import {
  ChevronDown,
  ChevronRight,
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
    <div className="overflow-x-auto border-y border-border/70">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Server</TableHead>
            <TableHead className="w-[220px]">Auth</TableHead>
            <TableHead className="w-[150px]">Status</TableHead>
            <TableHead className="w-[190px]">Transport</TableHead>
            <TableHead className="w-[96px] text-center">Specialists</TableHead>
            <TableHead className="w-[260px] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.servers.map((server) => (
            <McpPageServerRows
              key={server.id}
              server={server}
              isBusy={props.busyServerId === server.id}
              onViewTools={props.onViewTools}
              onEdit={props.onEdit}
              onReverify={props.onReverify}
              onConnectOAuth={props.onConnectOAuth}
              onDisconnectOAuth={props.onDisconnectOAuth}
              onDelete={props.onDelete}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function McpPageServerRows(props: {
  server: DashboardRemoteMcpServerRecord;
  isBusy: boolean;
  onViewTools(server: DashboardRemoteMcpServerRecord): void;
  onEdit(server: DashboardRemoteMcpServerRecord): void;
  onReverify(server: DashboardRemoteMcpServerRecord): void;
  onConnectOAuth(server: DashboardRemoteMcpServerRecord): void;
  onDisconnectOAuth(server: DashboardRemoteMcpServerRecord): void;
  onDelete(server: DashboardRemoteMcpServerRecord): void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const toolNames = summarizeDiscoveredToolNames(props.server.discovered_tools_snapshot);
  const isOauth = props.server.auth_mode === 'oauth';
  const connectLabel = props.server.oauth_connected ? 'Reconnect OAuth' : 'Connect OAuth';

  function stopRowToggle(action: () => void) {
    return (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      action();
    };
  }

  return (
    <Fragment>
      <TableRow className="cursor-pointer" onClick={() => setIsExpanded((value) => !value)}>
        <TableCell className="align-middle">
          <div className="flex items-start gap-2">
            {isExpanded ? (
              <ChevronDown className="mt-1 h-4 w-4 text-muted" />
            ) : (
              <ChevronRight className="mt-1 h-4 w-4 text-muted" />
            )}
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-foreground">{props.server.name}</span>
                <Badge variant="outline">{props.server.auth_mode}</Badge>
              </div>
              <div className="text-xs text-foreground">
                {props.server.description || 'No description provided.'}
              </div>
              <div className="text-xs text-foreground">{props.server.endpoint_url}</div>
              <div className="text-xs text-foreground">Call timeout: {props.server.call_timeout_seconds}s</div>
            </div>
          </div>
        </TableCell>
        <TableCell className="align-middle">
          <div className="space-y-1 text-sm">
            <div className="font-medium text-foreground">{buildAuthLabel(props.server)}</div>
            <div className="text-xs text-muted">
              Default on new specialists:{' '}
              {props.server.enabled_by_default_for_new_specialists ? 'On' : 'Off'}
            </div>
            {isOauth ? (
              <div className="text-xs text-muted">
                {props.server.oauth_connected
                  ? props.server.oauth_needs_reauth
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
              <StatusBadge server={props.server} />
            </div>
            {props.server.verification_error ? (
              <div className="text-xs text-red-600 dark:text-red-400">
                {props.server.verification_error}
              </div>
            ) : null}
          </div>
        </TableCell>
        <TableCell className="align-middle text-sm text-foreground">
          <span className="whitespace-nowrap">
            {formatRemoteMcpTransport(props.server.verified_transport)}
          </span>
        </TableCell>
        <TableCell className="w-[96px] align-middle text-center text-sm text-foreground">
          {props.server.assigned_specialist_count}
        </TableCell>
        <TableCell className="align-middle">
          <div className="flex flex-nowrap justify-end gap-2 whitespace-nowrap">
            <IconActionButton
              label="View capabilities"
              disabled={props.isBusy}
              onClick={stopRowToggle(() => props.onViewTools(props.server))}
            >
              <Wrench className="h-4 w-4" />
            </IconActionButton>
            <IconActionButton
              label="Edit"
              disabled={props.isBusy}
              onClick={stopRowToggle(() => props.onEdit(props.server))}
            >
              <Pencil className="h-4 w-4" />
            </IconActionButton>
            <IconActionButton
              label="Reverify"
              disabled={props.isBusy}
              onClick={stopRowToggle(() => props.onReverify(props.server))}
            >
              <RotateCcw className="h-4 w-4" />
            </IconActionButton>
            {isOauth ? (
              <IconActionButton
                label={connectLabel}
                disabled={props.isBusy}
                onClick={stopRowToggle(() => props.onConnectOAuth(props.server))}
              >
                <Plug className="h-4 w-4" />
              </IconActionButton>
            ) : null}
            {isOauth && props.server.oauth_connected ? (
              <IconActionButton
                label="Disconnect OAuth"
                disabled={props.isBusy}
                onClick={stopRowToggle(() => props.onDisconnectOAuth(props.server))}
              >
                <Unplug className="h-4 w-4" />
              </IconActionButton>
            ) : null}
            <IconActionButton
              label="Delete"
              disabled={props.isBusy}
              onClick={stopRowToggle(() => props.onDelete(props.server))}
            >
              <Trash2 className="h-4 w-4" />
            </IconActionButton>
          </div>
        </TableCell>
      </TableRow>
      {isExpanded ? (
        <TableRow>
          <TableCell colSpan={6} className="bg-border/10">
            <div className="space-y-2 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
                Capabilities summary
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-border/70 bg-background/80 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
                    Capability counts
                  </div>
                  <div className="mt-2 text-sm text-foreground">
                    {formatDiscoveredCapabilitySummary(props.server)}
                  </div>
                </div>
                <div className="rounded-lg border border-border/70 bg-background/80 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
                    Discovered tools
                  </div>
                  <div className="mt-2 text-sm text-foreground">
                    {toolNames.length > 0
                      ? `${toolNames.length} tool${toolNames.length === 1 ? '' : 's'} discovered: ${toolNames.join(', ')}`
                      : 'No discovered tools snapshot.'}
                  </div>
                </div>
              </div>
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </Fragment>
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
