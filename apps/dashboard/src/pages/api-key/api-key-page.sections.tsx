import { Key, Plus, ShieldAlert, ShieldCheck, TimerReset } from 'lucide-react';

import { DashboardPageHeader } from '../../components/layout/dashboard-page-header.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card.js';
import type { DashboardApiKeyRecord } from '../../lib/api.js';
import {
  formatAbsoluteTimestamp,
  formatDateLabel,
  formatExpiryLabel,
  formatRelativeTimestamp,
} from '../governance-shared/governance-lifecycle.support.js';
import {
  scopeLabel,
  scopeName,
  splitApiKeys,
  summarizeApiKeys,
} from './api-key-page.support.js';

const TABLE_COLUMN_WIDTHS = ['18%', '14%', '26%', '14%', '14%', '7%', '7%'] as const;

export function ApiKeyHeader(props: { onCreate(): void }): JSX.Element {
  return (
    <DashboardPageHeader
      navHref="/admin/api-keys"
      description="Issue short-lived credentials, review stale usage, and retire keys outside the operator lifecycle."
      actions={
        <Button onClick={props.onCreate} className="w-full sm:w-auto">
          <Plus className="h-4 w-4" />
          Create API key
        </Button>
      }
      className="lg:items-end"
    />
  );
}

export function ApiKeyCapabilityNotice(): JSX.Element {
  return (
    <Card className="border-blue-200 bg-blue-50/80 shadow-sm dark:border-blue-900 dark:bg-blue-950/20">
      <CardContent className="flex gap-3 p-4 text-sm text-blue-950 dark:text-blue-100">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Admin and Service keys are unrestricted and grant full platform control in this release.
          Granular permissions will be introduced in a future release.
        </p>
      </CardContent>
    </Card>
  );
}

export function ApiKeyOverview(props: { apiKeys: DashboardApiKeyRecord[] }): JSX.Element {
  const summary = summarizeApiKeys(props.apiKeys);
  const packets = [
    {
      title: 'Active keys',
      value: `${summary.active}`,
      detail: 'Currently usable credentials',
      icon: ShieldCheck,
    },
    {
      title: 'Admin / Service scope',
      value: `${summary.operator}`,
      detail: 'High-impact keys to review first',
      icon: ShieldAlert,
    },
    {
      title: 'Expiring soon',
      value: `${summary.expiringSoon}`,
      detail: 'Operator keys expiring in 7 days',
      icon: TimerReset,
    },
    {
      title: 'Never used',
      value: `${summary.neverUsed}`,
      detail: 'Candidates for revoke or relabel',
      icon: Key,
    },
  ];

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {packets.map((packet) => (
        <Card key={packet.title} className="border-border/70 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted">{packet.title}</CardTitle>
            <packet.icon className="h-4 w-4 text-muted" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{packet.value}</p>
            <p className="mt-2 text-xs leading-5 text-muted">{packet.detail}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function ApiKeyEmptyState(props: { onCreate(): void }): JSX.Element {
  return (
    <Card className="border-dashed border-border/70 shadow-sm">
      <CardHeader>
        <CardTitle>No API keys yet</CardTitle>
        <CardDescription>
          Issue operator-managed access only when a person or external integration actually needs it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl text-sm leading-6 text-muted">
          Start with a clear label, keep expiry tight unless the integration is intentionally
          long-lived, and let system keys stay platform-managed.
        </p>
        <Button onClick={props.onCreate} className="w-full sm:w-auto">
          <Plus className="h-4 w-4" />
          Create first API key
        </Button>
      </CardContent>
    </Card>
  );
}

export function ApiKeyLifecycleSection(props: {
  apiKeys: DashboardApiKeyRecord[];
  onRevoke(record: DashboardApiKeyRecord): void;
}): JSX.Element {
  const { operatorKeys, systemKeys } = splitApiKeys(props.apiKeys);

  return (
    <div className="space-y-6">
      <ApiKeyTableSection
        title="Admin / Service Keys"
        description="Create and revoke operator-managed credentials for people and external integrations."
        apiKeys={operatorKeys}
        onRevoke={props.onRevoke}
        emptyMessage="No Admin or Service keys have been issued yet."
        kind="operator"
      />
      <ApiKeyTableSection
        title="System Keys"
        description="System keys are created and deleted automatically with agent lifecycle."
        apiKeys={systemKeys}
        onRevoke={props.onRevoke}
        emptyMessage="No system keys are currently active."
        kind="system"
      />
    </div>
  );
}

function ApiKeyTableSection(props: {
  title: string;
  description: string;
  apiKeys: DashboardApiKeyRecord[];
  onRevoke(record: DashboardApiKeyRecord): void;
  emptyMessage: string;
  kind: 'operator' | 'system';
}): JSX.Element {
  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {props.apiKeys.length === 0 ? <p className="text-sm text-muted">{props.emptyMessage}</p> : null}
        {props.apiKeys.length > 0 ? (
          <>
            <div className="grid gap-3 lg:hidden">
              {props.apiKeys.map((key) => (
                <ApiKeyMobileCard
                  key={key.id}
                  record={key}
                  onRevoke={props.onRevoke}
                  kind={props.kind}
                />
              ))}
            </div>
            <div className="hidden lg:block">
              <div className="relative w-full overflow-x-auto">
                <table className="w-full table-fixed caption-bottom text-sm">
                  <colgroup>
                    {TABLE_COLUMN_WIDTHS.map((width) => (
                      <col key={width} style={{ width }} />
                    ))}
                  </colgroup>
                  <thead className="[&_tr]:border-b">
                    <tr className="border-b border-border">
                      <th className="h-10 px-4 text-left font-medium text-muted">Key</th>
                      <th className="h-10 px-4 text-left font-medium text-muted">Scope</th>
                      <th className="h-10 px-4 text-left font-medium text-muted">Label</th>
                      <th className="h-10 px-4 text-left font-medium text-muted">Last used</th>
                      <th className="h-10 px-4 text-left font-medium text-muted">Expiry</th>
                      <th className="h-10 px-4 text-left font-medium text-muted">Status</th>
                      <th className="h-10 px-4 text-right font-medium text-muted">Action</th>
                    </tr>
                  </thead>
                  <tbody className="[&_tr:last-child]:border-0">
                    {props.apiKeys.map((key) => (
                      <tr
                        key={key.id}
                        className="border-b border-border transition-colors hover:bg-border/20"
                      >
                        <td className="p-4 align-middle">
                          <div className="space-y-1">
                            <p className="font-mono text-xs">{key.key_prefix}...</p>
                            <p className="text-xs text-muted">{formatDateLabel(key.created_at)}</p>
                          </div>
                        </td>
                        <td className="p-4 align-middle">
                          <ScopeCell scope={key.scope} />
                        </td>
                        <td className="p-4 align-middle text-muted">{key.label ?? 'Unlabeled'}</td>
                        <td
                          className="p-4 align-middle text-muted"
                          title={formatAbsoluteTimestamp(key.last_used_at)}
                        >
                          {formatRelativeTimestamp(key.last_used_at)}
                        </td>
                        <td
                          className="p-4 align-middle text-muted"
                          title={formatAbsoluteTimestamp(key.expires_at)}
                        >
                          {formatExpiryLabel(key.expires_at)}
                        </td>
                        <td className="p-4 align-middle">
                          <StatusBadge record={key} />
                        </td>
                        <td className="p-4 text-right align-middle">
                          <ActionCell record={key} kind={props.kind} onRevoke={props.onRevoke} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ApiKeyMobileCard(props: {
  record: DashboardApiKeyRecord;
  onRevoke(record: DashboardApiKeyRecord): void;
  kind: 'operator' | 'system';
}): JSX.Element {
  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader className="space-y-3 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="font-mono text-sm">{props.record.key_prefix}...</CardTitle>
            <CardDescription title={formatAbsoluteTimestamp(props.record.created_at)}>
              Created {formatRelativeTimestamp(props.record.created_at)}
            </CardDescription>
          </div>
          <StatusBadge record={props.record} />
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <ReviewField
          label="Scope"
          value={scopeLabel(props.record.scope)}
        />
        <ReviewField label="Label" value={props.record.label ?? 'Unlabeled'} />
        <ReviewField
          label="Last used"
          value={formatRelativeTimestamp(props.record.last_used_at)}
          title={formatAbsoluteTimestamp(props.record.last_used_at)}
        />
        <ReviewField
          label="Expiry"
          value={formatExpiryLabel(props.record.expires_at)}
          title={formatAbsoluteTimestamp(props.record.expires_at)}
        />
        <ActionCell record={props.record} kind={props.kind} onRevoke={props.onRevoke} />
      </CardContent>
    </Card>
  );
}

function ScopeCell(props: { scope: string }): JSX.Element {
  return <span className="text-muted">{scopeName(props.scope)}</span>;
}

function StatusBadge(props: { record: DashboardApiKeyRecord }): JSX.Element {
  return (
    <Badge variant={props.record.is_revoked ? 'secondary' : 'success'}>
      {props.record.is_revoked ? 'Revoked' : 'Active'}
    </Badge>
  );
}

function ActionCell(props: {
  record: DashboardApiKeyRecord;
  kind: 'operator' | 'system';
  onRevoke(record: DashboardApiKeyRecord): void;
}): JSX.Element {
  if (props.kind === 'system') {
    return <span className="text-xs text-muted">Automatic</span>;
  }

  if (props.record.is_revoked) {
    return <span className="text-xs text-muted">No action</span>;
  }

  return (
    <Button variant="destructive" size="sm" onClick={() => props.onRevoke(props.record)}>
      Revoke API key
    </Button>
  );
}

function ReviewField(props: {
  label: string;
  value: string;
  title?: string;
}): JSX.Element {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted">{props.label}</p>
      <p className="text-sm" title={props.title}>
        {props.value}
      </p>
    </div>
  );
}
