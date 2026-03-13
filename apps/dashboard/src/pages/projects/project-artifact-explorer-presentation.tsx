import { ChevronLeft, ChevronRight, Eye, ExternalLink, FileText, Package, Workflow } from 'lucide-react';
import { Link } from 'react-router-dom';

import { buildArtifactPermalink } from '../../components/artifact-preview-support.js';
import { StructuredRecordView } from '../../components/structured-data.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Skeleton } from '../../components/ui/skeleton.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs.js';
import { cn } from '../../lib/utils.js';
import {
  formatArtifactFileSize,
  type ProjectArtifactEntry,
  type ProjectArtifactSummary,
} from './project-artifact-explorer-support.js';

export function ProjectArtifactExplorerSummary(props: {
  summary: ProjectArtifactSummary;
}): JSX.Element {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <SummaryCard label="Artifacts in scope" value={String(props.summary.totalArtifacts)} helper="Filtered artifact set currently visible to the operator." />
      <SummaryCard label="Previewable" value={String(props.summary.previewableArtifacts)} helper="Artifacts eligible for inline inspection without leaving the page." />
      <SummaryCard label="Source coverage" value={`${props.summary.workflowCount} workflows / ${props.summary.taskCount} tasks`} helper="Cross-workflow delivery coverage currently represented in this scope." />
      <SummaryCard label="Payload volume" value={formatArtifactFileSize(props.summary.totalBytes)} helper={`${props.summary.workItemCount} work items and ${props.summary.roleCount} roles represented in the visible artifact set.`} />
    </div>
  );
}

export function ProjectArtifactExplorerList(props: {
  artifacts: ProjectArtifactEntry[];
  isLoading: boolean;
  pagination: {
    page: number;
    totalPages: number;
    totalArtifacts: number;
    pageSize: number;
    onPrevious(): void;
    onNext(): void;
  };
  selectedArtifactId: string;
  selectedArtifactIds: string[];
  onSelectArtifact(artifactId: string): void;
  onToggleArtifact(artifactId: string): void;
}): JSX.Element {
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Artifacts</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {props.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={`artifact-skeleton-${index}`} className="h-28 rounded-2xl" />
            ))}
          </div>
        ) : props.artifacts.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-center text-muted">
            <Package className="mb-3 h-10 w-10" />
            <p className="font-medium">No artifacts matched the current scope</p>
            <p className="mt-1 max-w-md text-sm">
              Adjust the filters or wait for downstream tasks to publish new delivery outputs.
            </p>
          </div>
        ) : (
          props.artifacts.map((artifact) => {
            const isSelected = artifact.id === props.selectedArtifactId;
            const isChecked = props.selectedArtifactIds.includes(artifact.id);
            return (
              <article
                key={artifact.id}
                className={cn(
                  'rounded-2xl border border-border/70 bg-card/60 p-4 transition hover:border-accent/40 hover:bg-card',
                  isSelected && 'border-accent/50 bg-accent/5 shadow-sm',
                )}
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="flex items-start gap-3">
                    <input
                      aria-label={`Select ${artifact.fileName}`}
                      checked={isChecked}
                      className="mt-1 h-4 w-4 rounded border-border text-accent focus:ring-accent"
                      type="checkbox"
                      onChange={() => props.onToggleArtifact(artifact.id)}
                    />
                    <button className="min-w-0 flex-1 text-left" type="button" onClick={() => props.onSelectArtifact(artifact.id)}>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{artifact.contentType}</Badge>
                        {artifact.stageName ? <Badge variant="secondary">{artifact.stageName}</Badge> : null}
                        {artifact.role ? <Badge variant="secondary">{artifact.role}</Badge> : null}
                        <Badge variant={artifact.canPreview ? 'success' : 'outline'}>
                          {artifact.canPreview ? 'Inline preview' : 'Download only'}
                        </Badge>
                        {Object.keys(artifact.metadata).length > 0 ? (
                          <Badge variant="outline">
                            {Object.keys(artifact.metadata).length} metadata
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-3 text-sm font-semibold">{artifact.fileName}</p>
                      <p className="mt-1 truncate font-mono text-xs text-muted">{artifact.logicalPath}</p>
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted">
                        <span>{artifact.workflowName}</span>
                        {artifact.workItemTitle ? <span>{artifact.workItemTitle}</span> : null}
                        <span>{artifact.taskTitle}</span>
                        <span>{formatArtifactFileSize(artifact.sizeBytes)}</span>
                        <span>{formatRelativeTimestamp(artifact.createdAt)}</span>
                      </div>
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => props.onSelectArtifact(artifact.id)}>
                      <Eye className="h-4 w-4" />
                      Inspect
                    </Button>
                    <Button asChild variant="outline" size="sm">
                      <a href={artifact.downloadUrl}>Download</a>
                    </Button>
                    <Button asChild size="sm">
                      <Link to={buildArtifactPermalink(artifact.taskId, artifact.artifactId)}>
                        Open Preview
                      </Link>
                    </Button>
                  </div>
                </div>
              </article>
            );
          })
        )}
        <ProjectArtifactPagination
          page={props.pagination.page}
          totalPages={props.pagination.totalPages}
          totalArtifacts={props.pagination.totalArtifacts}
          pageSize={props.pagination.pageSize}
          onPrevious={props.pagination.onPrevious}
          onNext={props.pagination.onNext}
        />
      </CardContent>
    </Card>
  );
}

export function ProjectArtifactQuickInspector(props: {
  artifact: ProjectArtifactEntry | null;
  previewMarkup: string;
  previewText: string;
  previewKind: string;
  isPreviewLoading: boolean;
  previewError: string | null;
}): JSX.Element {
  return (
    <Card className="xl:sticky xl:top-20">
      <CardHeader>
        <CardTitle>Quick Inspection</CardTitle>
      </CardHeader>
      <CardContent>
        {!props.artifact ? (
          <div className="flex flex-col items-center py-12 text-center text-muted">
            <Eye className="mb-3 h-10 w-10" />
            <p className="font-medium">Select an artifact to inspect</p>
            <p className="mt-1 text-sm">Previewable payloads, metadata, and source links will appear here.</p>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{props.artifact.contentType}</Badge>
                <Badge variant="secondary">{formatArtifactFileSize(props.artifact.sizeBytes)}</Badge>
                <Badge variant="outline">{formatRelativeTimestamp(props.artifact.createdAt)}</Badge>
              </div>
              <div>
                <p className="text-base font-semibold">{props.artifact.fileName}</p>
                <p className="mt-1 break-all font-mono text-xs text-muted">{props.artifact.logicalPath}</p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <InspectorPacket title="Workflow" value={props.artifact.workflowName} helper={props.artifact.workflowState ?? 'Workflow context'} icon={<Workflow className="h-4 w-4" />} />
              <InspectorPacket title="Task" value={props.artifact.taskTitle} helper={props.artifact.taskState} icon={<Package className="h-4 w-4" />} />
              <InspectorPacket title="Work item" value={props.artifact.workItemTitle ?? 'Unlinked'} helper={props.artifact.stageName ?? 'No stage'} icon={<FileText className="h-4 w-4" />} />
              <InspectorPacket title="Role" value={props.artifact.role ?? 'Unassigned'} helper="Operator handoff source" icon={<Eye className="h-4 w-4" />} />
              <InspectorPacket title="Delivery" value={props.artifact.canPreview ? 'Inline preview' : 'Download only'} helper={props.artifact.contentType} icon={<ExternalLink className="h-4 w-4" />} />
              <InspectorPacket title="Metadata" value={`${Object.keys(props.artifact.metadata).length} fields`} helper="Structured artifact packet fields recorded at publish time." icon={<Package className="h-4 w-4" />} />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link to={`/work/tasks/${props.artifact.taskId}`}>Open Task</Link>
              </Button>
              {props.artifact.workflowId ? (
                <Button asChild variant="outline" size="sm">
                  <Link to={`/work/boards/${props.artifact.workflowId}`}>Open Workflow Board</Link>
                </Button>
              ) : null}
              <Button asChild size="sm">
                <Link to={buildArtifactPermalink(props.artifact.taskId, props.artifact.artifactId)}>
                  <ExternalLink className="h-4 w-4" />
                  Full Preview
                </Link>
              </Button>
            </div>

            <Tabs defaultValue="preview" className="space-y-4">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="preview">Preview</TabsTrigger>
                <TabsTrigger value="raw">Raw</TabsTrigger>
                <TabsTrigger value="metadata">Metadata</TabsTrigger>
              </TabsList>
              <TabsContent value="preview" className="space-y-3">
                {props.isPreviewLoading ? (
                  <Skeleton className="h-56 rounded-2xl" />
                ) : props.previewError ? (
                  <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                    {props.previewError}
                  </div>
                ) : props.previewKind === 'binary' ? (
                  <BinaryNotice />
                ) : props.previewMarkup ? (
                  <div className="prose prose-sm max-w-none rounded-2xl border border-border/70 bg-background/80 p-4 dark:prose-invert" dangerouslySetInnerHTML={{ __html: props.previewMarkup }} />
                ) : (
                  <pre className="max-h-[360px] overflow-auto rounded-2xl border border-border/70 bg-background/80 p-4 text-xs leading-6">
                    {props.previewText}
                  </pre>
                )}
              </TabsContent>
              <TabsContent value="raw">
                <pre className="max-h-[360px] overflow-auto rounded-2xl border border-border/70 bg-background/80 p-4 text-xs leading-6">
                  {props.previewText || 'No inline raw payload available for this artifact.'}
                </pre>
              </TabsContent>
              <TabsContent value="metadata">
                <StructuredRecordView data={props.artifact.metadata} emptyMessage="No artifact metadata recorded." />
              </TabsContent>
            </Tabs>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ProjectArtifactExplorerSkeleton(props: {
  showHeader: boolean;
}): JSX.Element {
  return (
    <div className="space-y-6">
      {props.showHeader ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-[34rem]" />
        </div>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={`summary-${index}`} className="h-28 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-44 rounded-2xl" />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.95fr)]">
        <Skeleton className="h-[34rem] rounded-2xl" />
        <Skeleton className="h-[34rem] rounded-2xl" />
      </div>
    </div>
  );
}

function SummaryCard(props: {
  label: string;
  value: string;
  helper: string;
}): JSX.Element {
  return (
    <Card>
      <CardContent className="space-y-2 pt-6">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">{props.label}</p>
        <p className="text-3xl font-semibold tracking-tight">{props.value}</p>
        <p className="text-sm text-muted">{props.helper}</p>
      </CardContent>
    </Card>
  );
}

function InspectorPacket(props: {
  title: string;
  value: string;
  helper: string;
  icon: JSX.Element;
}): JSX.Element {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted">
        {props.icon}
        {props.title}
      </div>
      <p className="mt-3 text-sm font-semibold">{props.value}</p>
      <p className="mt-1 text-xs text-muted">{props.helper}</p>
    </div>
  );
}

function BinaryNotice(): JSX.Element {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/80 p-4 text-sm text-muted">
      This artifact is better reviewed through download or the standalone preview page. Inline rendering is intentionally limited to text-like formats and safe sizes.
    </div>
  );
}

function ProjectArtifactPagination(props: {
  page: number;
  totalPages: number;
  totalArtifacts: number;
  pageSize: number;
  onPrevious(): void;
  onNext(): void;
}): JSX.Element | null {
  if (props.totalArtifacts <= props.pageSize) {
    return null;
  }

  const start = props.page * props.pageSize - props.pageSize + 1;
  const end = Math.min(props.page * props.pageSize, props.totalArtifacts);

  return (
    <div className="flex flex-col gap-3 border-t border-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted">
        Showing {start}-{end} of {props.totalArtifacts} matched artifacts.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">
          Page {props.page} of {props.totalPages}
        </span>
        <Button variant="outline" size="sm" disabled={props.page <= 1} onClick={props.onPrevious}>
          <ChevronLeft className="h-4 w-4" />
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={props.page >= props.totalPages}
          onClick={props.onNext}
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function formatRelativeTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }
  const deltaMinutes = Math.round((Date.now() - timestamp) / 60000);
  if (deltaMinutes < 1) {
    return 'just now';
  }
  if (deltaMinutes < 60) {
    return `${deltaMinutes}m ago`;
  }
  const deltaHours = Math.round(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `${deltaHours}h ago`;
  }
  const deltaDays = Math.round(deltaHours / 24);
  return `${deltaDays}d ago`;
}
