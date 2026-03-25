import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, FileDown, Hammer, Link2, Loader2, ShieldCheck } from 'lucide-react';
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
} from '../../lib/api.js';
import {
  buildRuntimeHistorySummaryCards,
  buildRuntimeRecoveryBrief,
  buildHistoryFromStatus,
  describeBuildOutcome,
  describeExportOutcome,
  describeGatesSummary,
  describeLinkOutcome,
  describeRuntimeNextAction,
  describeRuntimePosture,
  describeValidationOutcome,
  formatDigestAsImage,
  formatDigestLabel,
  statusBadgeVariant,
  deriveStatusFromState,
} from './runtimes-build-history.support.js';
import { ActiveRuntimeManifestPacket } from './runtimes-build-history.packet.js';

export function ActiveRuntimeImageCard(): JSX.Element {
  const { data: status, isLoading, error } = useQuery({
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
    return <RuntimeLoadingCard title="Active Specialist Agent Image" />;
  }
  if (error || !status) {
    return (
      <RuntimeUnavailableCard
        title="Active Specialist Agent Image"
        body="Specialist Agent image status unavailable. The customization service may not be configured or reachable."
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
            <CardTitle className="text-base">Active Specialist Agent Image</CardTitle>
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
            Recovery is rebuild-or-relink only on this surface. Direct rollback is not exposed until versioned Specialist Agent image history exists.
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
        body="Unable to load build history. Inspect the Specialist Agent image service connection before trusting rollout state."
      />
    );
  }

  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader className="space-y-2">
        <CardTitle className="text-base">Build History</CardTitle>
        <p className="text-sm text-muted">
          Recent Specialist Agent image linkage and recovery posture. Review the active digest and
          recovery path before changing Specialist Agent defaults.
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
            No Specialist Agent image builds recorded yet. Build or link a Specialist Agent image before rollout work begins.
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

export function RuntimeManagementCard(): JSX.Element {
  const queryClient = useQueryClient();
  const [lastBuildId, setLastBuildId] = useState<string | null>(null);

  const validateMutation = useMutation({
    mutationFn: async () => {
      const inspect = await dashboardApi.reconstructCustomization();
      return dashboardApi.validateCustomization({ manifest: inspect.manifest });
    },
  });

  const buildMutation = useMutation({
    mutationFn: async () => {
      const inspect = await dashboardApi.reconstructCustomization();
      return dashboardApi.createCustomizationBuild({ manifest: inspect.manifest });
    },
    onSuccess: (result) => {
      if (result.build_id) setLastBuildId(result.build_id);
      void queryClient.invalidateQueries({ queryKey: ['runtime-customization-status'] });
    },
  });

  const linkMutation = useMutation({
    mutationFn: (buildId: string) =>
      dashboardApi.linkCustomizationBuild({ build_id: buildId }),
    onSuccess: () => {
      setLastBuildId(null);
      void queryClient.invalidateQueries({ queryKey: ['runtime-customization-status'] });
    },
  });

  const exportMutation = useMutation({
    mutationFn: () =>
      dashboardApi.exportCustomization({ artifact_type: 'manifest', format: 'json' }),
  });

  function handleValidate(): void {
    buildMutation.reset();
    linkMutation.reset();
    exportMutation.reset();
    validateMutation.mutate();
  }

  function handleBuild(): void {
    validateMutation.reset();
    linkMutation.reset();
    exportMutation.reset();
    buildMutation.mutate();
  }

  function handleLink(): void {
    if (!lastBuildId) return;
    validateMutation.reset();
    buildMutation.reset();
    exportMutation.reset();
    linkMutation.mutate(lastBuildId);
  }

  function handleExport(): void {
    validateMutation.reset();
    buildMutation.reset();
    linkMutation.reset();
    exportMutation.mutate();
  }

  const anyPending =
    validateMutation.isPending ||
    buildMutation.isPending ||
    linkMutation.isPending ||
    exportMutation.isPending;

  const validationOutcome = validateMutation.data
    ? describeValidationOutcome(validateMutation.data)
    : null;
  const buildOutcome = buildMutation.data
    ? describeBuildOutcome(buildMutation.data)
    : null;
  const linkOutcome = linkMutation.data
    ? describeLinkOutcome(linkMutation.data)
    : null;
  const exportOutcome = exportMutation.data
    ? describeExportOutcome(exportMutation.data)
    : null;

  const mutationError =
    validateMutation.error ?? buildMutation.error ?? linkMutation.error ?? exportMutation.error;

  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader className="space-y-2">
        <CardTitle className="text-base">Specialist Agent Image Management</CardTitle>
        <p className="text-sm text-muted">
          Validate, build, link, and export Specialist Agent image artifacts from the reconstructed manifest.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={handleValidate} disabled={anyPending}>
            {validateMutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <ShieldCheck className="h-3 w-3" />
            )}
            Validate manifest
          </Button>
          <Button variant="outline" size="sm" onClick={handleBuild} disabled={anyPending}>
            {buildMutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Hammer className="h-3 w-3" />
            )}
            Build Specialist Agent image
          </Button>
          {lastBuildId ? (
            <Button variant="outline" size="sm" onClick={handleLink} disabled={anyPending}>
              {linkMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Link2 className="h-3 w-3" />
              )}
              Link build
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={handleExport} disabled={anyPending}>
            {exportMutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <FileDown className="h-3 w-3" />
            )}
            Export manifest
          </Button>
        </div>

        {validationOutcome ? (
          <RuntimeActionResult
            tone={validationOutcome.valid ? 'linked' : 'failed'}
            headline={validationOutcome.headline}
          >
            {validationOutcome.errors.length > 0 ? (
              <ul className="mt-2 grid gap-1">
                {validationOutcome.errors.map((e) => (
                  <li key={e.field} className="text-xs text-muted">
                    <span className="font-mono">{e.field}</span>: {e.message} &mdash; {e.remediation}
                  </li>
                ))}
              </ul>
            ) : null}
          </RuntimeActionResult>
        ) : null}

        {buildOutcome ? (
          <RuntimeActionResult tone={buildOutcome.tone} headline={buildOutcome.headline}>
            <p className="mt-1 text-xs text-muted">{buildOutcome.detail}</p>
            {buildMutation.data?.gates && buildMutation.data.gates.length > 0 ? (
              <p className="mt-1 text-xs text-muted">
                Gates: {describeGatesSummary(buildMutation.data.gates)}
              </p>
            ) : null}
          </RuntimeActionResult>
        ) : null}

        {linkOutcome ? (
          <RuntimeActionResult tone={linkOutcome.tone} headline={linkOutcome.headline}>
            <p className="mt-1 text-xs text-muted">{linkOutcome.detail}</p>
          </RuntimeActionResult>
        ) : null}

        {exportOutcome ? (
          <RuntimeActionResult
            tone={exportOutcome.hasContent ? 'linked' : 'valid'}
            headline={exportOutcome.headline}
          >
            <p className="mt-1 text-xs text-muted">{exportOutcome.detail}</p>
            {exportOutcome.hasContent && exportMutation.data?.content ? (
              <pre className="mt-2 max-h-48 overflow-auto rounded-xl border border-border/70 bg-background/70 p-3 text-xs font-mono">
                {exportMutation.data.content}
              </pre>
            ) : null}
          </RuntimeActionResult>
        ) : null}

        {mutationError ? (
          <p className="text-sm text-destructive">
            {mutationError instanceof Error
              ? mutationError.message
              : 'Action failed. Check service connectivity.'}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function RuntimeActionResult(props: {
  tone: 'linked' | 'valid' | 'failed';
  headline: string;
  children?: ReactNode;
}): JSX.Element {
  const toneClasses =
    props.tone === 'failed'
      ? 'border-rose-300/70 bg-rose-500/5'
      : props.tone === 'linked'
        ? 'border-emerald-300/70 bg-emerald-500/5'
        : 'border-amber-300/70 bg-amber-500/5';

  return (
    <div className={`rounded-xl border p-4 ${toneClasses}`}>
      <p className="text-sm font-medium">{props.headline}</p>
      {props.children}
    </div>
  );
}
