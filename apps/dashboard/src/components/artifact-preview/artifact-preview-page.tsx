import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, Download, FileText, Loader2, Package } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { dashboardApi } from '../../lib/api.js';
import { readArtifactPreviewReturnState } from '../../lib/artifact-navigation.js';
import { toast } from '../../lib/toast.js';
import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs.js';
import {
  buildArtifactPermalink,
  describeArtifactPreview,
  formatArtifactPreviewText,
  MAX_INLINE_ARTIFACT_PREVIEW_BYTES,
  renderArtifactPreviewMarkup,
} from './artifact-preview-support.js';
import {
  buildArtifactPreviewOperatorNavigation,
  formatArtifactPreviewFileSize,
  getPreviewModeLabel,
} from './artifact-preview-page.support.js';
import {
  ArtifactMetadataCard,
  BinaryPreviewNotice,
  LargePreviewNotice,
  PreviewStateNotice,
} from './artifact-preview-page.sections.js';

export function ArtifactPreviewPage(): JSX.Element {
  const { taskId = '', artifactId = '' } = useParams<{ taskId: string; artifactId: string }>();
  const [searchParams] = useSearchParams();
  const [isDownloading, setIsDownloading] = useState(false);

  const artifactListQuery = useQuery({
    queryKey: ['task-artifacts', taskId],
    queryFn: () => dashboardApi.listTaskArtifacts(taskId),
    enabled: taskId.length > 0,
  });
  const taskQuery = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => dashboardApi.getTask(taskId),
    enabled: taskId.length > 0,
  });

  const artifact = useMemo(() => artifactListQuery.data?.find((entry) => entry.id === artifactId) ?? null, [artifactId, artifactListQuery.data]);
  const previewDescriptor = artifact
    ? describeArtifactPreview(artifact.content_type, artifact.logical_path)
    : null;
  const shouldFetchPreview =
    Boolean(artifact) &&
    Boolean(previewDescriptor?.canPreview) &&
    (artifact?.size_bytes ?? 0) <= MAX_INLINE_ARTIFACT_PREVIEW_BYTES;

  const previewQuery = useQuery({
    queryKey: ['task-artifact-content', taskId, artifactId],
    queryFn: () => dashboardApi.readTaskArtifactContent(taskId, artifactId),
    enabled: shouldFetchPreview,
  });

  const previewMarkup = previewDescriptor && previewQuery.data ? renderArtifactPreviewMarkup(previewQuery.data.content_text, previewDescriptor) : '';
  const previewText = previewDescriptor && previewQuery.data ? formatArtifactPreviewText(previewQuery.data.content_text, previewDescriptor) : '';
  const artifactName = artifact?.logical_path.split('/').pop() ?? artifact?.id ?? 'artifact';
  const previewModeLabel = getPreviewModeLabel(artifact, previewDescriptor);
  const previewLimitLabel = formatArtifactPreviewFileSize(MAX_INLINE_ARTIFACT_PREVIEW_BYTES);
  const operatorNavigation = buildArtifactPreviewOperatorNavigation({
    taskId,
    task: taskQuery.data,
    returnContext: readArtifactPreviewReturnState(searchParams),
  });

  async function handleCopyPermalink() {
    const permalink = `${window.location.origin}${buildArtifactPermalink(taskId, artifactId)}`;
    if (!navigator.clipboard) {
      toast.error('Clipboard access is unavailable in this browser');
      return;
    }
    await navigator.clipboard.writeText(permalink);
    toast.success('Artifact permalink copied');
  }

  async function handleDownload() {
    if (!artifact) {
      return;
    }
    setIsDownloading(true);
    try {
      const artifactDownload = await dashboardApi.downloadTaskArtifact(taskId, artifactId);
      const objectUrl = URL.createObjectURL(artifactDownload.blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download =
        artifactDownload.file_name ?? artifact.logical_path.split('/').pop() ?? artifact.id;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } finally {
      setIsDownloading(false);
    }
  }

  if (artifactListQuery.isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center p-12">
        <div className="flex items-center gap-3 rounded-2xl border border-border/70 bg-card px-5 py-4 shadow-sm">
          <Loader2 className="h-5 w-5 animate-spin text-muted" />
          <div>
            <p className="text-sm font-medium">Loading artifact preview</p>
            <p className="text-xs text-muted-foreground">
              Fetching artifact metadata and inline preview eligibility.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (artifactListQuery.error || !artifact || !previewDescriptor) {
    return (
      <div className="space-y-6 p-6">
        <section className="rounded-[28px] border border-rose-200 bg-rose-50/80 p-6 shadow-sm">
          <div className="space-y-2">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-rose-700">
              Artifact preview unavailable
            </p>
            <h1 className="text-2xl font-semibold text-rose-950">Failed to load artifact preview</h1>
            <p className="max-w-2xl text-sm text-rose-800">
              The dashboard could not resolve this artifact or its preview metadata. Re-open the
              higher-level operator flow or step diagnostics and retry from the artifact list.
            </p>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div data-testid="artifact-preview-surface" className="space-y-6 p-6">
      <section className="rounded-[32px] border border-border/70 bg-gradient-to-br from-card via-card to-muted/20 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-3xl space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                Artifact preview
              </p>
              <div className="flex items-center gap-3">
                <span className="rounded-2xl border border-border/70 bg-background/80 p-3">
                  <Package className="h-5 w-5 text-muted-foreground" />
                </span>
                <div className="space-y-1">
                  <h1 className="text-2xl font-semibold tracking-tight">{artifactName}</h1>
                  <p className="font-mono text-xs text-muted-foreground">{artifact.logical_path}</p>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{artifact.content_type}</Badge>
              <Badge variant="outline">{formatArtifactPreviewFileSize(artifact.size_bytes)}</Badge>
              <Badge variant="secondary">{previewModeLabel}</Badge>
              <Badge variant="outline">task {artifact.task_id}</Badge>
            </div>
            <div data-testid="artifact-preview-metadata-grid" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <ArtifactMetadataCard label="Artifact ID" value={artifact.id} helper="Stable operator reference for audit and handoff." />
              <ArtifactMetadataCard label="Operator flow" value={operatorNavigation.primaryLabel} helper={operatorNavigation.primaryHelper} />
              <ArtifactMetadataCard label="Step diagnostics" value={`Task ${artifact.task_id}`} helper={operatorNavigation.diagnosticHref ? 'Use only when you need lower-level runtime and execution detail.' : 'This artifact only has direct step context.'} />
              <ArtifactMetadataCard label="Preview policy" value={previewModeLabel} helper={`Inline previews are capped at ${previewLimitLabel}.`} />
              <ArtifactMetadataCard label="Inspection path" value={previewDescriptor.kind === 'binary' ? 'Download original' : 'Rendered and raw'} helper="Operators can inspect the rendered view, raw content, or download the source." />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to={operatorNavigation.primaryHref}>{operatorNavigation.primaryLabel}</Link>
            </Button>
            {operatorNavigation.diagnosticHref ? (
              <Button asChild variant="outline" size="sm">
                <Link to={operatorNavigation.diagnosticHref}>
                  {operatorNavigation.diagnosticLabel}
                </Link>
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => void handleCopyPermalink()}>
              <Copy className="h-4 w-4" />
              Copy Permalink
            </Button>
            <Button variant="outline" size="sm" onClick={() => void handleDownload()} disabled={isDownloading}>
              {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Download
            </Button>
            <Button asChild size="sm">
              <Link to={buildArtifactPermalink(taskId, artifactId)}>Open Permalink</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="rounded-[32px] border border-border/70 bg-card/80 p-5 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-3">
          <article className="rounded-2xl border border-border/60 bg-background/80 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Review checklist
            </p>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li>Confirm the rendered view matches the expected artifact path and content type.</li>
              <li>Use the raw tab to inspect the source payload before approving downstream work.</li>
              <li>Download the original file when the inline view is truncated or unavailable.</li>
            </ul>
          </article>
          <article className="rounded-2xl border border-border/60 bg-background/80 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Source context
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              {operatorNavigation.sourceContextBody}
            </p>
          </article>
          <article className="rounded-2xl border border-border/60 bg-background/80 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Safety posture
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              Markdown and HTML previews are sanitized before rendering. Unsafe scripts, frames, and
              executable links are stripped so operators can review model-authored content safely.
            </p>
          </article>
        </div>
      </section>

      <section className="rounded-[32px] border border-border/70 bg-card/80 p-5 shadow-sm">
        <Card className="border-border/60 shadow-none">
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText className="h-4 w-4" />
                  Preview workspace
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Review the rendered document and its raw payload before making operator decisions.
                </p>
              </div>
              <Badge variant="outline">Inline limit {previewLimitLabel}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {!previewDescriptor.canPreview ? (
              <BinaryPreviewNotice artifactSize={artifact.size_bytes} />
            ) : artifact.size_bytes > MAX_INLINE_ARTIFACT_PREVIEW_BYTES ? (
              <LargePreviewNotice artifactSize={artifact.size_bytes} />
            ) : previewQuery.isLoading ? (
              <PreviewStateNotice
                title="Loading inline preview"
                body="Fetching the artifact body and preparing the rendered inspection view."
                accent="muted"
                icon={<Loader2 className="h-4 w-4 animate-spin" />}
              />
            ) : previewQuery.error ? (
              <PreviewStateNotice
                title="Inline preview failed"
                body="The artifact metadata loaded, but the content body could not be fetched. Return to the operator flow or open step diagnostics before retrying the source file."
                accent="danger"
                icon={<FileText className="h-4 w-4" />}
              />
            ) : (
              <Tabs defaultValue="rendered" data-testid="artifact-preview-tabs" className="space-y-4">
                <TabsList className="grid w-full max-w-sm grid-cols-2">
                  <TabsTrigger value="rendered">Rendered</TabsTrigger>
                  <TabsTrigger value="raw">Raw</TabsTrigger>
                </TabsList>
                <TabsContent value="rendered">
                  {previewDescriptor.kind === 'markdown' || previewDescriptor.kind === 'html' ? (
                    <article className="prose prose-slate max-w-none rounded-2xl border border-border/70 bg-muted/20 p-5" dangerouslySetInnerHTML={{ __html: previewMarkup }} />
                  ) : (
                    <pre className="min-h-[320px] overflow-x-auto rounded-2xl border border-border/70 bg-muted/20 p-5 text-xs"><code>{previewText}</code></pre>
                  )}
                </TabsContent>
                <TabsContent value="raw">
                  <pre className="min-h-[320px] overflow-x-auto rounded-2xl border border-border/70 bg-slate-950 p-5 text-xs text-slate-100"><code>{previewQuery.data?.content_text ?? ''}</code></pre>
                </TabsContent>
              </Tabs>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
