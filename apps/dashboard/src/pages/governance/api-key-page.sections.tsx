import { Key, Plus, ShieldAlert, ShieldCheck, TimerReset } from 'lucide-react';

import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card.js';
import type { DashboardApiKeyRecord } from '../../lib/api.js';
import {
  formatAbsoluteTimestamp,
  formatDateLabel,
  formatExpiryLabel,
  formatRelativeTimestamp,
} from './governance-lifecycle.support.js';
import { describeOwner, scopeVariant, summarizeApiKeys } from './api-key-page.support.js';

export function ApiKeyHeader(props: { onCreate(): void }): JSX.Element {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Key className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-2xl font-semibold tracking-tight">API Keys</h1>
        </div>
        <p className="max-w-3xl text-sm leading-6 text-muted">
          Issue short-lived credentials, review stale usage at a glance, and revoke anything that no longer belongs in the operator lifecycle.
        </p>
      </div>
      <Button onClick={props.onCreate} className="w-full sm:w-auto">
        <Plus className="h-4 w-4" />
        Create API key
      </Button>
    </div>
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
      title: 'Admin scope',
      value: `${summary.admin}`,
      detail: 'High-impact keys to review first',
      icon: ShieldAlert,
    },
    {
      title: 'Expiring soon',
      value: `${summary.expiringSoon}`,
      detail: 'Active keys expiring in 7 days',
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
          Issue a short-lived key only when a person, automation path, or agent actually needs one.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl text-sm leading-6 text-muted">
          Start with agent scope, add a clear owner label, and keep expiry tight so stale keys are easy to retire.
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
  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader>
        <CardTitle>Issued API keys</CardTitle>
        <CardDescription>
          Review scope, owner, and expiry before revoking. Relative timestamps keep stale credentials easy to spot.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 lg:hidden">
          {props.apiKeys.map((key) => (
            <ApiKeyMobileCard key={key.id} record={key} onRevoke={props.onRevoke} />
          ))}
        </div>
        <div className="hidden lg:block">
          <div className="relative w-full overflow-x-auto">
            <table className="w-full caption-bottom text-sm">
              <thead className="[&_tr]:border-b">
                <tr className="border-b border-border">
                  <th className="h-10 px-4 text-left font-medium text-muted">Key</th>
                  <th className="h-10 px-4 text-left font-medium text-muted">Scope</th>
                  <th className="h-10 px-4 text-left font-medium text-muted">Owner</th>
                  <th className="h-10 px-4 text-left font-medium text-muted">Label</th>
                  <th className="h-10 px-4 text-left font-medium text-muted">Last used</th>
                  <th className="h-10 px-4 text-left font-medium text-muted">Expiry</th>
                  <th className="h-10 px-4 text-left font-medium text-muted">Status</th>
                  <th className="h-10 px-4 text-right font-medium text-muted">Action</th>
                </tr>
              </thead>
              <tbody className="[&_tr:last-child]:border-0">
                {props.apiKeys.map((key) => (
                  <tr key={key.id} className="border-b border-border transition-colors hover:bg-border/20">
                    <td className="p-4 align-middle">
                      <div className="space-y-1">
                        <p className="font-mono text-xs">{key.key_prefix}...</p>
                        <p className="text-xs text-muted">{formatDateLabel(key.created_at)}</p>
                      </div>
                    </td>
                    <td className="p-4 align-middle">
                      <Badge variant={scopeVariant(key.scope)} className="capitalize">
                        {key.scope}
                      </Badge>
                    </td>
                    <td className="p-4 align-middle text-muted">{describeOwner(key)}</td>
                    <td className="p-4 align-middle text-muted">{key.label ?? 'Unlabeled'}</td>
                    <td className="p-4 align-middle text-muted" title={formatAbsoluteTimestamp(key.last_used_at)}>
                      {formatRelativeTimestamp(key.last_used_at)}
                    </td>
                    <td className="p-4 align-middle text-muted" title={formatAbsoluteTimestamp(key.expires_at)}>
                      {formatExpiryLabel(key.expires_at)}
                    </td>
                    <td className="p-4 align-middle">
                      <Badge variant={key.is_revoked ? 'destructive' : 'success'}>
                        {key.is_revoked ? 'Revoked' : 'Active'}
                      </Badge>
                    </td>
                    <td className="p-4 text-right align-middle">
                      {key.is_revoked ? (
                        <span className="text-xs text-muted">No action</span>
                      ) : (
                        <Button variant="destructive" size="sm" onClick={() => props.onRevoke(key)}>
                          Revoke API key
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ApiKeyMobileCard(props: {
  record: DashboardApiKeyRecord;
  onRevoke(record: DashboardApiKeyRecord): void;
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
          <Badge variant={props.record.is_revoked ? 'destructive' : 'success'}>
            {props.record.is_revoked ? 'Revoked' : 'Active'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <ReviewField label="Scope" value={props.record.scope} badgeVariant={scopeVariant(props.record.scope)} />
        <ReviewField label="Owner" value={describeOwner(props.record)} />
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
        {!props.record.is_revoked ? (
          <Button variant="destructive" size="sm" onClick={() => props.onRevoke(props.record)}>
            Revoke API key
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ReviewField(props: {
  label: string;
  value: string;
  title?: string;
  badgeVariant?: 'default' | 'success' | 'destructive' | 'warning' | 'secondary';
}): JSX.Element {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted">{props.label}</p>
      {props.badgeVariant ? (
        <Badge variant={props.badgeVariant} className="inline-flex capitalize">
          {props.value}
        </Badge>
      ) : (
        <p className="text-sm" title={props.title}>
          {props.value}
        </p>
      )}
    </div>
  );
}
