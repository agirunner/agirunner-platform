import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, Download, FileText, Loader2, Package } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';

import { dashboardApi } from '../lib/api.js';
import { toast } from '../lib/toast.js';
import { Badge } from './ui/badge.js';
import { Button } from './ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs.js';
import {
  buildArtifactPermalink,
  describeArtifactPreview,
  formatArtifactPreviewText,
  MAX_INLINE_ARTIFACT_PREVIEW_BYTES,
  renderArtifactPreviewMarkup,
} from './artifact-preview-support.js';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ArtifactPreviewPage(): JSX.Element {
  const { taskId = '', artifactId = '' } = useParams<{ taskId: string; artifactId: string }>();
  const [isDownloading, setIsDownloading] = useState(false);

  const artifactListQuery = useQuery({
    queryKey: ['task-artifacts', taskId],
    queryFn: () => dashboardApi.listTaskArtifacts(taskId),
    enabled: taskId.length > 0,
  });

  const artifact = useMemo(
    () => artifactListQuery.data?.find((entry) => entry.id === artifactId) ?? null,
    [artifactId, artifactListQuery.data],
  );
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

  const previewMarkup =
    previewDescriptor && previewQuery.data
      ? renderArtifactPreviewMarkup(previewQuery.data.content_text, previewDescriptor)
      : '';
  const previewText =
    previewDescriptor && previewQuery.data
      ? formatArtifactPreviewText(previewQuery.data.content_text, previewDescriptor)
      : '';

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
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (artifactListQuery.error || !artifact || !previewDescriptor) {
    return (
      <div className="space-y-6 p-6">
        <Card>
          <CardContent className="py-6 text-sm text-red-600">
            Failed to load artifact preview.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-muted" />
            <h1 className="text-2xl font-semibold">{artifact.logical_path}</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{artifact.content_type}</Badge>
            <Badge variant="outline">{formatFileSize(artifact.size_bytes)}</Badge>
            <Badge variant="secondary">task {artifact.task_id}</Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void handleCopyPermalink()}>
            <Copy className="h-4 w-4" />
            Copy Permalink
          </Button>
          <Button variant="outline" size="sm" onClick={() => void handleDownload()} disabled={isDownloading}>
            {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Download
          </Button>
          <Button asChild size="sm">
            <Link to={`/work/tasks/${artifact.task_id}`}>Open Task</Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <FileText className="h-4 w-4" />
            Preview
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!previewDescriptor.canPreview ? (
            <BinaryPreviewNotice artifactSize={artifact.size_bytes} />
          ) : artifact.size_bytes > MAX_INLINE_ARTIFACT_PREVIEW_BYTES ? (
            <LargePreviewNotice artifactSize={artifact.size_bytes} />
          ) : previewQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading artifact preview...
            </div>
          ) : previewQuery.error ? (
            <p className="text-sm text-red-600">Failed to load artifact content.</p>
          ) : (
            <Tabs defaultValue="rendered">
              <TabsList>
                <TabsTrigger value="rendered">Rendered</TabsTrigger>
                <TabsTrigger value="raw">Raw</TabsTrigger>
              </TabsList>
              <TabsContent value="rendered">
                {previewDescriptor.kind === 'markdown' || previewDescriptor.kind === 'html' ? (
                  <article
                    className="prose prose-sm max-w-none rounded-md border bg-border/10 p-4"
                    dangerouslySetInnerHTML={{ __html: previewMarkup }}
                  />
                ) : (
                  <pre className="overflow-x-auto rounded-md border bg-border/10 p-4 text-xs">
                    <code>{previewText}</code>
                  </pre>
                )}
              </TabsContent>
              <TabsContent value="raw">
                <pre className="overflow-x-auto rounded-md border bg-border/10 p-4 text-xs">
                  <code>{previewQuery.data?.content_text ?? ''}</code>
                </pre>
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BinaryPreviewNotice(props: { artifactSize: number }): JSX.Element {
  return (
    <div className="rounded-md border bg-border/10 p-4 text-sm text-muted">
      This artifact is not previewable inline. Use the download action to inspect the original file.
      <div className="mt-2">Artifact size: {formatFileSize(props.artifactSize)}</div>
    </div>
  );
}

function LargePreviewNotice(props: { artifactSize: number }): JSX.Element {
  return (
    <div className="rounded-md border bg-border/10 p-4 text-sm text-muted">
      Inline preview is limited to {formatFileSize(MAX_INLINE_ARTIFACT_PREVIEW_BYTES)} to keep the
      dashboard responsive. This artifact is {formatFileSize(props.artifactSize)}.
    </div>
  );
}
