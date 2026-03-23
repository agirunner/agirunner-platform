import { FileText } from 'lucide-react';
import { Link } from 'react-router-dom';

import type { DashboardTaskArtifactRecord } from '../../lib/api.js';
import { buildArtifactPermalink } from '../../components/artifact-preview-support.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent } from '../../components/ui/card.js';
import { TableCell, TableRow } from '../../components/ui/table.js';
import {
  formatContentFileSize,
  formatContentRelativeTimestamp,
} from './workspace-content-browser-support.js';

export function ArtifactCard(props: {
  artifact: DashboardTaskArtifactRecord;
  previewHref?: string;
  deletingArtifactId?: string | null;
  onDelete?(artifact: DashboardTaskArtifactRecord): void;
}): JSX.Element {
  return (
    <Card className="border-border/70 bg-card/70">
      <CardContent className="space-y-4 pt-5">
        <ArtifactIdentity artifact={props.artifact} />
        <ArtifactDeliveryPacket artifact={props.artifact} />
        <div className="flex flex-wrap items-center gap-2">
          <Link
            className="inline-flex items-center gap-1 text-sm text-accent hover:underline"
            to={props.previewHref ?? buildArtifactPermalink(props.artifact.task_id, props.artifact.id)}
          >
            <FileText className="h-3.5 w-3.5" />
            Preview
          </Link>
          <Button asChild size="sm" variant="outline">
            <a href={props.artifact.download_url}>Download</a>
          </Button>
          {props.onDelete ? (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => props.onDelete?.(props.artifact)}
              disabled={props.deletingArtifactId === props.artifact.id}
            >
              {props.deletingArtifactId === props.artifact.id ? 'Deleting…' : 'Delete'}
            </Button>
          ) : null}
          <Link
            className="text-sm text-accent hover:underline"
            to={`/work/tasks/${props.artifact.task_id}`}
          >
            Open task
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

export function ArtifactDesktopRow(props: {
  artifact: DashboardTaskArtifactRecord;
  taskId: string;
  previewHref?: string;
  deletingArtifactId?: string | null;
  onDelete?(artifact: DashboardTaskArtifactRecord): void;
}): JSX.Element {
  return (
    <TableRow>
      <TableCell className="min-w-[280px] align-top">
        <ArtifactIdentity artifact={props.artifact} />
      </TableCell>
      <TableCell className="min-w-[280px] align-top">
        <ArtifactDeliveryPacket artifact={props.artifact} />
      </TableCell>
      <TableCell className="align-top text-sm text-muted-foreground">
        <span title={formatAbsoluteTimestamp(props.artifact.created_at)}>
          {formatContentRelativeTimestamp(props.artifact.created_at)}
        </span>
      </TableCell>
      <TableCell className="align-top">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            className="inline-flex items-center gap-1 text-sm text-accent hover:underline"
            to={props.previewHref ?? buildArtifactPermalink(props.artifact.task_id, props.artifact.id)}
          >
            <FileText className="h-3.5 w-3.5" />
            Preview
          </Link>
          <Button asChild size="sm" variant="outline">
            <a href={props.artifact.download_url}>Download</a>
          </Button>
          {props.onDelete ? (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => props.onDelete?.(props.artifact)}
              disabled={props.deletingArtifactId === props.artifact.id}
            >
              {props.deletingArtifactId === props.artifact.id ? 'Deleting…' : 'Delete'}
            </Button>
          ) : null}
          <Link className="text-sm text-accent hover:underline" to={`/work/tasks/${props.taskId}`}>
            Open task
          </Link>
        </div>
      </TableCell>
    </TableRow>
  );
}

function ArtifactIdentity(props: { artifact: DashboardTaskArtifactRecord }): JSX.Element {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{props.artifact.content_type}</Badge>
        <Badge variant="secondary">{formatContentFileSize(props.artifact.size_bytes)}</Badge>
        {Object.keys(props.artifact.metadata ?? {}).length > 0 ? (
          <Badge variant="outline">
            {Object.keys(props.artifact.metadata).length} metadata fields
          </Badge>
        ) : null}
      </div>
      <div>
        <p className="text-sm font-semibold">{extractArtifactName(props.artifact.logical_path)}</p>
        <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
          {props.artifact.logical_path}
        </p>
      </div>
    </div>
  );
}

function ArtifactDeliveryPacket(props: { artifact: DashboardTaskArtifactRecord }): JSX.Element {
  return (
    <div className="space-y-2 rounded-xl border border-border/70 bg-background/70 p-3">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
        Delivery packet
      </p>
      <p className="text-sm font-medium">
        Task {compactIdentifier(props.artifact.task_id)}
        {props.artifact.workflow_id
          ? ` • workflow ${compactIdentifier(props.artifact.workflow_id)}`
          : ''}
      </p>
      <p className="text-xs text-muted-foreground">
        Added {formatContentRelativeTimestamp(props.artifact.created_at)}
      </p>
    </div>
  );
}

function compactIdentifier(value: string): string {
  if (value.length <= 16) {
    return value;
  }
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function extractArtifactName(path: string): string {
  const segments = path.split('/');
  return segments[segments.length - 1] || path;
}

function formatAbsoluteTimestamp(value: string | null | undefined): string {
  if (!value) {
    return 'No timestamp recorded';
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }
  return new Date(timestamp).toLocaleString();
}
