import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { Button } from '../../../components/ui/button.js';
import {
  describeArtifactPreview,
  formatArtifactPreviewText,
  MAX_INLINE_ARTIFACT_PREVIEW_BYTES,
  renderArtifactPreviewMarkup,
} from '../../artifact-preview/artifact-preview-support.js';
import { dashboardApi } from '../../../lib/api.js';
import type {
  DashboardTaskArtifactContent,
  DashboardTaskArtifactRecord,
  DashboardWorkflowDeliverableRecord,
} from '../../../lib/api.js';
import { WorkflowDeliverableTargetLink } from './workflow-deliverable-target-link.js';
import {
  buildBrowserRows,
  formatArtifactSize,
  formatEntryTimestamp,
  type ArtifactBrowserRow,
  type DeliverableBrowserRow,
} from './workflow-deliverable-browser-support.js';

interface TaskArtifactIdentity {
  taskId: string;
  artifactId: string;
}

export function WorkflowDeliverableBrowser(props: {
  deliverable: DashboardWorkflowDeliverableRecord;
}): JSX.Element | null {
  const rows = useMemo(() => buildBrowserRows(props.deliverable), [props.deliverable]);
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);
  const selectedRow = rows.find((row) => row.key === selectedRowKey) ?? null;

  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-3">
      <div className="overflow-hidden rounded-xl border border-border/70 bg-background/70">
        <table className="w-full table-fixed border-collapse text-sm">
          <colgroup>
            <col className="w-[45%]" />
            <col className="w-[17%]" />
            <col className="w-[20%]" />
            <col className="w-[18%]" />
          </colgroup>
          <thead className="bg-muted/20 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Item</th>
              <th className="px-3 py-2 text-left font-medium">Type</th>
              <th className="px-3 py-2 text-left font-medium">Recorded</th>
              <th className="px-3 py-2 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isSelected = row.key === selectedRow?.key;
              return (
                <tr
                  key={row.key}
                  className={isSelected ? 'bg-accent/5' : 'border-t border-border/60'}
                >
                  <td className="px-3 py-2 align-top">
                    {row.canView ? (
                      <button
                        type="button"
                        className="text-left font-medium text-foreground underline-offset-4 hover:underline"
                        onClick={() => toggleRowSelection(row.key, setSelectedRowKey)}
                      >
                        {row.label}
                      </button>
                    ) : (
                      <span className="font-medium text-foreground">{row.label}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top text-muted-foreground">{row.typeLabel}</td>
                  <td className="px-3 py-2 align-top text-muted-foreground">
                    {formatEntryTimestamp(row.createdAt) ?? '—'}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="flex justify-end gap-2">
                      {row.canView ? (
                        <Button
                          type="button"
                          variant={isSelected ? 'secondary' : 'ghost'}
                          size="sm"
                          onClick={() => toggleRowSelection(row.key, setSelectedRowKey)}
                        >
                          {isSelected ? 'Hide' : 'View'}
                        </Button>
                      ) : null}
                      {row.rowKind === 'artifact' ? (
                        <ArtifactDownloadButton
                          row={row}
                          deliverableTitle={props.deliverable.title}
                        />
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selectedRow && selectedRow.canView ? (
        <section className="grid gap-3 rounded-xl border border-border/70 bg-background/80 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="grid gap-1">
              <p className="text-sm font-semibold text-foreground">{selectedRow.label}</p>
              <p className="text-xs text-muted-foreground">{selectedRow.typeLabel}</p>
            </div>
          </div>
          {selectedRow.rowKind === 'artifact' ? (
            <ArtifactPreviewPanel row={selectedRow} />
          ) : selectedRow.rowKind === 'inline' ? (
            <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-xl border border-border/70 bg-background p-3 text-xs text-foreground">
              {selectedRow.content}
            </pre>
          ) : (
            <WorkflowDeliverableTargetLink target={selectedRow.target} />
          )}
        </section>
      ) : null}
    </div>
  );
}

function toggleRowSelection(
  rowKey: string,
  setSelectedRowKey: (value: string | null | ((current: string | null) => string | null)) => void,
): void {
  setSelectedRowKey((current) => (current === rowKey ? null : rowKey));
}

export { resolveBrowserDownloadHref } from './workflow-deliverable-browser-support.js';

function ArtifactDownloadButton(props: {
  row: ArtifactBrowserRow;
  deliverableTitle: string;
}): JSX.Element {
  async function handleDownload(): Promise<void> {
    await downloadArtifactRow(props.row, props.deliverableTitle);
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={() => void handleDownload()}>
      Download
    </Button>
  );
}

function ArtifactPreviewPanel(props: {
  row: ArtifactBrowserRow;
}): JSX.Element {
  if (typeof window === 'undefined') {
    return (
      <PreviewNotice
        body="Artifact preview loads in the browser at runtime."
        meta={props.row.target.path ?? props.row.previewHref}
      />
    );
  }
  return <ArtifactPreviewClient {...props} />;
}

function ArtifactPreviewClient(props: {
  row: ArtifactBrowserRow;
}): JSX.Element {
  const taskArtifactIdentity = useMemo(
    () => resolveTaskArtifactIdentity(props.row.previewHref, props.row.downloadHref),
    [props.row.downloadHref, props.row.previewHref],
  );
  const taskArtifactsQuery = useQuery({
    queryKey: ['workflow-deliverable-task-artifacts', taskArtifactIdentity?.taskId ?? null],
    queryFn: () => dashboardApi.listTaskArtifacts(taskArtifactIdentity?.taskId ?? ''),
    enabled: taskArtifactIdentity !== null,
  });
  const taskArtifact = useMemo(
    () =>
      taskArtifactsQuery.data?.find((entry) => entry.id === taskArtifactIdentity?.artifactId) ?? null,
    [taskArtifactIdentity?.artifactId, taskArtifactsQuery.data],
  );
  const shouldFetchTaskPreview =
    taskArtifact !== null &&
    describeArtifactPreview(taskArtifact.content_type, taskArtifact.logical_path).canPreview &&
    taskArtifact.size_bytes <= MAX_INLINE_ARTIFACT_PREVIEW_BYTES;
  const taskPreviewQuery = useQuery({
    queryKey: [
      'workflow-deliverable-task-artifact-content',
      taskArtifactIdentity?.taskId ?? null,
      taskArtifactIdentity?.artifactId ?? null,
    ],
    queryFn: () =>
      dashboardApi.readTaskArtifactContent(
        taskArtifactIdentity?.taskId ?? '',
        taskArtifactIdentity?.artifactId ?? '',
      ),
    enabled: taskArtifactIdentity !== null && shouldFetchTaskPreview,
  });
  const genericPreviewQuery = useQuery({
    queryKey: ['workflow-deliverable-binary-content', props.row.previewHref],
    queryFn: () => dashboardApi.readBinaryContentByHref(props.row.previewHref),
    enabled: taskArtifactIdentity === null,
  });

  if (taskArtifactIdentity !== null && taskArtifactsQuery.isLoading) {
    return (
      <PreviewNotice
        body="Loading artifact preview metadata."
        meta={props.row.target.path ?? undefined}
      />
    );
  }

  const previewSource =
    taskArtifactIdentity !== null
      ? buildTaskArtifactPreviewSource(taskArtifact, taskPreviewQuery)
      : buildGenericPreviewSource(genericPreviewQuery, props.row.target.path);

  if (previewSource === null) {
    return (
      <PreviewNotice
        body="Preview is unavailable for this file right now. Download it from this row instead."
        meta={props.row.target.path ?? props.row.previewHref}
      />
    );
  }

  if (previewSource.status !== 'ready') {
    return <PreviewNotice body={previewSource.body} meta={previewSource.meta} />;
  }

  const previewBody =
    previewSource.descriptor.kind === 'markdown' || previewSource.descriptor.kind === 'html' ? (
      <div
        className="prose prose-sm max-w-none p-4 dark:prose-invert"
        dangerouslySetInnerHTML={{
          __html: renderArtifactPreviewMarkup(
            previewSource.content.content_text,
            previewSource.descriptor,
          ),
        }}
      />
    ) : (
      <pre className="overflow-x-auto whitespace-pre-wrap break-words p-4 text-xs text-foreground">
        {formatArtifactPreviewText(previewSource.content.content_text, previewSource.descriptor)}
      </pre>
    );

  return (
    <div className="grid gap-2">
      <p className="text-xs text-muted-foreground">{previewSource.meta}</p>
      <div className="rounded-xl border border-border/70 bg-background shadow-sm">
        {previewBody}
      </div>
    </div>
  );
}

interface ReadyPreviewSource {
  status: 'ready';
  descriptor: ReturnType<typeof describeArtifactPreview>;
  content: DashboardTaskArtifactContent;
  meta: string;
}

interface PreviewNoticeState {
  status: 'loading' | 'unavailable';
  body: string;
  meta?: string;
}

type PreviewSource = ReadyPreviewSource | PreviewNoticeState;

function buildTaskArtifactPreviewSource(
  artifact: DashboardTaskArtifactRecord | null,
  query: {
    data: DashboardTaskArtifactContent | undefined;
    isError: boolean;
  },
): PreviewSource | null {
  if (!artifact) {
    return null;
  }
  const descriptor = describeArtifactPreview(artifact.content_type, artifact.logical_path);
  const meta = `${artifact.content_type} • ${formatArtifactSize(artifact.size_bytes)}`;

  if (!descriptor.canPreview) {
    return {
      status: 'unavailable',
      body: 'Preview is unavailable for this file type. Download it from this row instead.',
      meta,
    };
  }
  if (artifact.size_bytes > MAX_INLINE_ARTIFACT_PREVIEW_BYTES) {
    return {
      status: 'unavailable',
      body: `Inline preview is limited to ${formatArtifactSize(MAX_INLINE_ARTIFACT_PREVIEW_BYTES)}. Download this file to inspect the full payload.`,
      meta,
    };
  }
  if (query.isError) {
    return {
      status: 'unavailable',
      body: 'Preview is unavailable for this file right now. Download it from this row instead.',
      meta,
    };
  }
  if (!query.data) {
    return {
      status: 'loading',
      body: 'Loading inline artifact preview.',
      meta,
    };
  }
  return {
    status: 'ready',
    descriptor,
    content: query.data,
    meta,
  };
}

function buildGenericPreviewSource(
  query: {
    data: DashboardTaskArtifactContent | undefined;
    isError: boolean;
  },
  fallbackPath: string | null | undefined,
): PreviewSource | null {
  if (query.isError) {
    return {
      status: 'unavailable',
      body: 'Preview is unavailable for this file right now. Download it from this row instead.',
    };
  }
  if (!query.data) {
    return {
      status: 'loading',
      body: 'Loading inline artifact preview.',
    };
  }
  const descriptor = describeArtifactPreview(
    query.data.content_type,
    fallbackPath ?? query.data.file_name ?? '',
  );
  const sizeBytes = Number.isFinite(query.data.size_bytes) ? query.data.size_bytes : 0;
  const meta = `${query.data.content_type} • ${formatArtifactSize(sizeBytes)}`;

  if (!descriptor.canPreview) {
    return {
      status: 'unavailable',
      body: 'Preview is unavailable for this file type. Download it from this row instead.',
      meta,
    };
  }
  if (sizeBytes > MAX_INLINE_ARTIFACT_PREVIEW_BYTES) {
    return {
      status: 'unavailable',
      body: `Inline preview is limited to ${formatArtifactSize(MAX_INLINE_ARTIFACT_PREVIEW_BYTES)}. Download this file to inspect the full payload.`,
      meta,
    };
  }
  return {
    status: 'ready',
    descriptor,
    content: query.data,
    meta,
  };
}

function PreviewNotice(props: { body: string; meta?: string }): JSX.Element {
  return (
    <div className="grid gap-2">
      {props.meta ? <p className="text-xs text-muted-foreground">{props.meta}</p> : null}
      <p className="rounded-xl border border-dashed border-border/70 bg-background px-3 py-5 text-sm text-muted-foreground">
        {props.body}
      </p>
    </div>
  );
}

async function downloadArtifactRow(row: ArtifactBrowserRow, deliverableTitle: string): Promise<void> {
  const taskArtifactIdentity = resolveTaskArtifactIdentity(row.previewHref, row.downloadHref);
  const download = taskArtifactIdentity
    ? await dashboardApi.downloadTaskArtifact(taskArtifactIdentity.taskId, taskArtifactIdentity.artifactId)
    : await dashboardApi.downloadBinaryByHref(row.downloadHref);
  const objectUrl = URL.createObjectURL(download.blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download =
    download.file_name ?? row.target.path?.split('/').pop() ?? row.label ?? deliverableTitle;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

function resolveTaskArtifactIdentity(...hrefs: Array<string | null>): TaskArtifactIdentity | null {
  for (const href of hrefs) {
    if (!href) {
      continue;
    }
    try {
      const parsed = new URL(href, 'http://dashboard.local');
      const match = parsed.pathname.match(
        /^\/api\/v1\/tasks\/([^/]+)\/artifacts\/([^/]+)(?:\/(preview|download|permalink))?$/,
      );
      const deprecatedMatch = parsed.pathname.match(/^\/artifacts\/tasks\/([^/]+)\/([^/?#]+)$/);
      const resolvedMatch = match ?? deprecatedMatch;
      if (resolvedMatch) {
        return {
          taskId: decodeURIComponent(resolvedMatch[1]),
          artifactId: decodeURIComponent(resolvedMatch[2]),
        };
      }
    } catch {
      continue;
    }
  }
  return null;
}
