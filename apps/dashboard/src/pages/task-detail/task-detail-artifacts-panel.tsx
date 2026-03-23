import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileText, Loader2, Package } from 'lucide-react';
import { Link } from 'react-router-dom';

import { dashboardApi, type DashboardTaskArtifactRecord } from '../../lib/api.js';
import {
  buildArtifactPermalink,
  describeArtifactPreview,
  MAX_INLINE_ARTIFACT_PREVIEW_BYTES,
} from '../../components/artifact-preview-support.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';

export function TaskDetailArtifactsPanel(props: { taskId: string }): JSX.Element {
  const { data, isLoading } = useQuery({
    queryKey: ['task-artifacts', props.taskId],
    queryFn: () => dashboardApi.listTaskArtifacts(props.taskId),
  });
  const artifacts = data ?? [];
  const summary = useMemo(() => summarizeArtifacts(artifacts), [artifacts]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-border/5 px-4 py-4 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading artifacts...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl bg-border/10 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">
          Artifact evidence packet
        </p>
        <h3 className="mt-2 text-lg font-semibold">{summary.nextStepTitle}</h3>
        <p className="mt-2 text-sm leading-6 text-muted">{summary.nextStepDetail}</p>
      </section>

      <div className="grid gap-3 md:grid-cols-3">
        <ArtifactSignalCard
          icon={<Package className="h-4 w-4" />}
          label="Artifacts recorded"
          value={String(artifacts.length)}
          helper={
            artifacts.length > 0
              ? `${summary.latestArtifactLabel} in this step packet`
              : 'No published files yet'
          }
        />
        <ArtifactSignalCard
          icon={<FileText className="h-4 w-4" />}
          label="Inline preview ready"
          value={String(summary.previewReadyCount)}
          helper={
            summary.previewReadyCount > 0
              ? 'Start with previewable output before opening raw payloads or downloads.'
              : 'No inline-safe files in this step packet'
          }
        />
        <ArtifactSignalCard
          icon={<Download className="h-4 w-4" />}
          label="Download-first files"
          value={String(summary.downloadOnlyCount)}
          helper={
            summary.downloadOnlyCount > 0
              ? 'Large or binary files will route through the preview workspace for safe download.'
              : 'All current files can open inline'
          }
        />
      </div>

      {artifacts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-border/5 px-4 py-6 text-sm text-muted">
          No artifacts published for this step yet. Inspect the output packet first, then come back
          here when the specialist publishes files or handoff documents.
        </div>
      ) : (
        <div className="grid gap-3">
          {artifacts.map((artifact) => (
            <ArtifactReviewCard key={artifact.id} artifact={artifact} />
          ))}
        </div>
      )}
    </div>
  );
}

function ArtifactReviewCard(props: {
  artifact: DashboardTaskArtifactRecord;
}): JSX.Element {
  const preview = describeArtifact(props.artifact);
  return (
    <article className="rounded-xl border border-border/70 bg-card/70 p-4 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-3">
          <div className="space-y-1">
            <p className="text-sm font-semibold">{props.artifact.logical_path}</p>
            <p className="text-sm text-muted">{preview.reviewGuidance}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{props.artifact.content_type}</Badge>
            <Badge variant="outline">{formatArtifactFileSize(props.artifact.size_bytes)}</Badge>
            <Badge variant={preview.canInline ? 'success' : 'secondary'}>
              {preview.statusLabel}
            </Badge>
            <Badge variant="outline" title={new Date(props.artifact.created_at).toLocaleString()}>
              Created {formatRelativeTime(props.artifact.created_at)}
            </Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          <Button asChild size="sm">
            <Link to={buildArtifactPermalink(props.artifact.task_id, props.artifact.id)}>
              Open preview workspace
            </Link>
          </Button>
        </div>
      </div>
    </article>
  );
}

function ArtifactSignalCard(props: {
  icon: JSX.Element;
  label: string;
  value: string;
  helper: string;
}): JSX.Element {
  return (
    <div className="rounded-xl border border-border/70 bg-card/70 p-4 shadow-sm">
      <div className="flex items-center gap-2 text-sm text-muted">
        {props.icon}
        {props.label}
      </div>
      <p className="mt-2 text-2xl font-semibold">{props.value}</p>
      <p className="mt-2 text-sm leading-6 text-muted">{props.helper}</p>
    </div>
  );
}

function summarizeArtifacts(artifacts: DashboardTaskArtifactRecord[]) {
  const previewReadyCount = artifacts.filter((artifact) =>
    describeArtifact(artifact).canInline,
  ).length;
  const downloadOnlyCount = artifacts.length - previewReadyCount;
  const latestArtifact = [...artifacts].sort((left, right) => {
    return (
      new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
    );
  })[0];

  if (artifacts.length === 0) {
    return {
      previewReadyCount: 0,
      downloadOnlyCount: 0,
      latestArtifactLabel: 'No artifact activity',
      nextStepTitle: 'Wait for published files',
      nextStepDetail:
        'This step has not published any artifacts yet. Review the output packet and execution context first, then return here when files are attached.',
    };
  }

  return {
    previewReadyCount,
    downloadOnlyCount,
    latestArtifactLabel: `Latest ${formatRelativeTime(latestArtifact.created_at)}`,
    nextStepTitle:
      previewReadyCount > 0
        ? 'Start with the preview workspace'
        : 'Open the artifact workspace for download review',
    nextStepDetail:
      previewReadyCount > 0
        ? 'Open the most relevant previewable file first so you can validate the rendered output before dropping into raw payloads or downloads.'
        : 'This step only has binary or oversized files right now. Use the preview workspace to inspect metadata first, then download the source file if needed.',
  };
}

function describeArtifact(artifact: DashboardTaskArtifactRecord) {
  const previewDescriptor = describeArtifactPreview(
    artifact.content_type,
    artifact.logical_path,
  );
  const canInline =
    previewDescriptor.canPreview &&
    artifact.size_bytes <= MAX_INLINE_ARTIFACT_PREVIEW_BYTES;
  return {
    canInline,
    statusLabel: canInline ? 'Inline preview ready' : 'Download-only artifact',
      reviewGuidance: canInline
      ? 'Start with the preview workspace so rendered output, raw payload, and download stay in one operator evidence flow.'
      : 'Use the preview workspace to inspect metadata and route to a safe download for this file.',
  };
}

function formatArtifactFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRelativeTime(value: string): string {
  const millis = new Date(value).getTime();
  if (!Number.isFinite(millis)) {
    return 'Unknown time';
  }
  const deltaSeconds = Math.round((Date.now() - millis) / 1000);
  const absSeconds = Math.abs(deltaSeconds);
  if (absSeconds < 60) {
    return deltaSeconds >= 0 ? `${absSeconds}s ago` : `in ${absSeconds}s`;
  }
  const absMinutes = Math.round(absSeconds / 60);
  if (absMinutes < 60) {
    return deltaSeconds >= 0 ? `${absMinutes}m ago` : `in ${absMinutes}m`;
  }
  const absHours = Math.round(absMinutes / 60);
  if (absHours < 24) {
    return deltaSeconds >= 0 ? `${absHours}h ago` : `in ${absHours}h`;
  }
  const absDays = Math.round(absHours / 24);
  return deltaSeconds >= 0 ? `${absDays}d ago` : `in ${absDays}d`;
}
