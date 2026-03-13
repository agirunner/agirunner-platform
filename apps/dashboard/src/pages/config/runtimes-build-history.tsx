import { useQuery } from '@tanstack/react-query';
import { Eye, Loader2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table.js';
import {
  dashboardApi,
  type DashboardCustomizationManifest,
  type DashboardCustomizationStatusResponse,
} from '../../lib/api.js';
import { readSession } from '../../lib/session.js';
import {
  buildRuntimeHistorySummaryCards,
  buildRuntimeRecoveryBrief,
  buildHistoryFromStatus,
  describeRuntimeNextAction,
  describeRuntimePosture,
  formatDigestAsImage,
  formatDigestLabel,
  statusBadgeVariant,
  deriveStatusFromState,
} from './runtimes-build-history.support.js';
import { ActiveRuntimeManifestPacket } from './runtimes-build-history.packet.js';

const API_BASE_URL = import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';

function authHeaders(): Record<string, string> {
  const session = readSession();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (session?.accessToken) {
    headers.Authorization = `Bearer ${session.accessToken}`;
  }
  return headers;
}

async function fetchRuntimeStatus(): Promise<DashboardCustomizationStatusResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/runtime/customizations/status`, {
    headers: authHeaders(),
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const body = await response.json();
  return body.data ?? body;
}

export function ActiveRuntimeImageCard(): JSX.Element {
  const { data: status, isLoading, error } = useQuery({
    queryKey: ['runtime-customization-status'],
    queryFn: fetchRuntimeStatus,
  });
  const [manifestVisible, setManifestVisible] = useState(false);
  const [manifest, setManifest] = useState<DashboardCustomizationManifest | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [isLoadingManifest, setIsLoadingManifest] = useState(false);

  async function handleViewManifest(): Promise<void> {
    if (manifestVisible) {
      setManifestVisible(false);
      return;
    }
    try {
      setIsLoadingManifest(true);
      const result = await dashboardApi.reconstructCustomization();
      setManifest(result.manifest);
      setManifestError(null);
      setManifestVisible(true);
    } catch {
      setManifest(null);
      setManifestError('Failed to load manifest.');
      setManifestVisible(true);
    } finally {
      setIsLoadingManifest(false);
    }
  }

  if (isLoading) {
    return <RuntimeLoadingCard title="Active Runtime Image" />;
  }
  if (error || !status) {
    return (
      <RuntimeUnavailableCard
        title="Active Runtime Image"
        body="Runtime status unavailable. The customization service may not be configured or reachable."
      />
    );
  }

  const derivedStatus = deriveStatusFromState(status);
  const recoveryBrief = buildRuntimeRecoveryBrief(status);

  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <CardTitle className="text-base">Active Runtime Image</CardTitle>
            <p className="text-sm text-muted">{describeRuntimePosture(status)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => void handleViewManifest()} disabled={isLoadingManifest}>
              {isLoadingManifest ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />}
              {manifestVisible ? 'Hide manifest packet' : 'Inspect manifest packet'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <RuntimePacket label="Image" value={formatDigestAsImage(status.active_digest) ?? 'No active image'} mono />
            <RuntimePacket label="Active digest" value={formatDigestLabel(status.active_digest)} mono />
            <RuntimePacket label="Configured digest" value={formatDigestLabel(status.configured_digest)} mono />
            <RuntimePacket
              label="Next action"
              value={describeRuntimeNextAction(status)}
              accent={derivedStatus === 'failed' ? 'destructive' : 'neutral'}
            />
          </div>
          <RuntimeBriefCard brief={recoveryBrief} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={statusBadgeVariant(derivedStatus)}>{derivedStatus}</Badge>
          <Badge variant="outline">{status.state}</Badge>
          <span className="text-xs text-muted">
            Recovery is rebuild-or-relink only on this surface. Direct rollback is not exposed until versioned runtime history exists.
          </span>
        </div>
        {manifestVisible ? (
          manifest ? (
            <ActiveRuntimeManifestPacket manifest={manifest} />
          ) : (
            <div className="rounded-xl border border-dashed border-border/70 bg-muted/10 p-4 text-sm text-muted">
              {manifestError ?? 'Manifest data is unavailable right now.'}
            </div>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}

export function BuildHistoryCard(): JSX.Element {
  const { data: status, isLoading, error } = useQuery({
    queryKey: ['runtime-customization-status'],
    queryFn: fetchRuntimeStatus,
  });
  const entries = buildHistoryFromStatus(status);
  const summaryCards = buildRuntimeHistorySummaryCards(status, entries);

  if (isLoading) {
    return <RuntimeLoadingCard title="Build History" />;
  }
  if (error) {
    return (
      <RuntimeUnavailableCard
        title="Build History"
        body="Unable to load build history. Inspect the runtime service connection before trusting rollout state."
      />
    );
  }

  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader className="space-y-2">
        <CardTitle className="text-base">Build History</CardTitle>
        <p className="text-sm text-muted">
          Recent runtime build linkage and recovery posture. Review the active digest and recovery
          path before changing runtime defaults.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {summaryCards.map((summary) => (
            <RuntimePacket
              key={summary.label}
              label={summary.label}
              value={summary.value}
              accent={summary.label === 'Recovery path' && summary.value !== 'No recovery needed.' ? 'destructive' : 'neutral'}
            >
              {summary.detail}
            </RuntimePacket>
          ))}
        </div>
        {entries.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border/70 bg-muted/10 p-4 text-sm text-muted">
            No runtime builds recorded yet. Build or link a runtime image before rollout work begins.
          </p>
        ) : (
          <>
            <div className="grid gap-3 lg:hidden">
              {entries.map((entry) => (
                <div key={entry.buildId} className="grid gap-3 rounded-xl border border-border/70 bg-muted/10 p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold">{entry.buildId}</p>
                      <p className="text-xs text-muted">{entry.recoveryPath}</p>
                    </div>
                    <Badge variant={statusBadgeVariant(entry.status)}>{entry.status}</Badge>
                  </div>
                  <RuntimePacket label="Image" value={entry.image ?? 'No image'} mono />
                  <RuntimePacket label="Reported" value={entry.date} />
                </div>
              ))}
            </div>
            <div className="hidden overflow-x-auto lg:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Build</TableHead>
                    <TableHead>Posture</TableHead>
                    <TableHead>Image</TableHead>
                    <TableHead>Reported</TableHead>
                    <TableHead>Recovery path</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => (
                    <TableRow key={entry.buildId}>
                      <TableCell className="font-mono text-xs">{entry.buildId}</TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant(entry.status)}>{entry.status}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{entry.image ?? '\u2014'}</TableCell>
                      <TableCell className="text-xs">{entry.date}</TableCell>
                      <TableCell className="text-sm">{entry.recoveryPath}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function RuntimePacket(props: {
  label: string;
  value: string;
  mono?: boolean;
  accent?: 'neutral' | 'destructive';
  children?: ReactNode;
}): JSX.Element {
  return (
    <div className={`rounded-xl border p-4 ${props.accent === 'destructive' ? 'border-rose-300/70 bg-rose-500/5' : 'border-border/70 bg-muted/10'}`}>
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">{props.label}</p>
      <p className={`mt-2 text-sm leading-6 ${props.mono ? 'font-mono text-xs' : 'font-medium'}`}>{props.value}</p>
      {props.children ? (
        <div className="mt-2 text-xs leading-5 text-muted">{props.children}</div>
      ) : null}
    </div>
  );
}

function RuntimeBriefCard(props: { brief: ReturnType<typeof buildRuntimeRecoveryBrief> }): JSX.Element {
  const toneClasses =
    props.brief.tone === 'failed'
      ? 'border-rose-300/70 bg-rose-500/5'
      : props.brief.tone === 'valid'
        ? 'border-amber-300/70 bg-amber-500/5'
        : 'border-emerald-300/70 bg-emerald-500/5';

  return (
    <div className={`rounded-xl border p-4 ${toneClasses}`}>
      <div className="space-y-1">
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
          Operator recovery brief
        </p>
        <p className="text-sm font-medium text-foreground">{props.brief.headline}</p>
        <p className="text-xs leading-5 text-muted">{props.brief.detail}</p>
      </div>
      <ol className="mt-3 grid gap-2 text-sm text-foreground">
        {props.brief.steps.map((step, index) => (
          <li key={step} className="flex items-start gap-2">
            <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-current/20 text-[11px] font-semibold">
              {index + 1}
            </span>
            <span className="leading-6">{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function RuntimeLoadingCard(props: { title: string }): JSX.Element {
  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base">{props.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-center p-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted" />
      </CardContent>
    </Card>
  );
}

function RuntimeUnavailableCard(props: { title: string; body: string }): JSX.Element {
  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base">{props.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted">{props.body}</p>
      </CardContent>
    </Card>
  );
}
