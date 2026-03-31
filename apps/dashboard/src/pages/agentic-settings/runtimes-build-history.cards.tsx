import { useQuery } from '@tanstack/react-query';
import { Eye, Loader2 } from 'lucide-react';
import { useState } from 'react';

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
import { dashboardApi, type DashboardCustomizationManifest } from '../../lib/api.js';
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
import {
  RuntimeBriefCard,
  RuntimeLoadingCard,
  RuntimePacket,
  RuntimeUnavailableCard,
} from './runtimes-build-history.shared.js';

export function ActiveRuntimeImageCard(): JSX.Element {
  const {
    data: status,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['runtime-customization-status'],
    queryFn: () => dashboardApi.getCustomizationStatus(),
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
        body="Runtime image status unavailable. The customization service may not be configured or reachable."
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleViewManifest()}
              disabled={isLoadingManifest}
            >
              {isLoadingManifest ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Eye className="h-3 w-3" />
              )}
              {manifestVisible ? 'Hide manifest packet' : 'Inspect manifest packet'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <RuntimePacket
              label="Image"
              value={formatDigestAsImage(status.active_digest) ?? 'No active image'}
              mono
            />
            <RuntimePacket
              label="Active digest"
              value={formatDigestLabel(status.active_digest)}
              mono
            />
            <RuntimePacket
              label="Configured digest"
              value={formatDigestLabel(status.configured_digest)}
              mono
            />
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
            Recovery is rebuild-or-relink only on this surface. Direct rollback is not exposed until
            versioned runtime image history exists.
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
  const {
    data: status,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['runtime-customization-status'],
    queryFn: () => dashboardApi.getCustomizationStatus(),
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
        body="Unable to load build history. Inspect the specialist agent image service connection before trusting rollout state."
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
              accent={
                summary.label === 'Recovery path' && summary.value !== 'No recovery needed.'
                  ? 'destructive'
                  : 'neutral'
              }
            >
              {summary.detail}
            </RuntimePacket>
          ))}
        </div>
        {entries.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border/70 bg-muted/10 p-4 text-sm text-muted">
            No runtime image builds recorded yet. Build or link a runtime image before rollout work
            begins.
          </p>
        ) : (
          <>
            <div className="grid gap-3 lg:hidden">
              {entries.map((entry) => (
                <div
                  key={entry.buildId}
                  className="grid gap-3 rounded-xl border border-border/70 bg-muted/10 p-4 shadow-sm"
                >
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
