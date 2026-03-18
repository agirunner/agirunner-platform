import { FileText } from 'lucide-react';
import { Link } from 'react-router-dom';

import type { DashboardResolvedDocumentReference } from '../../lib/api.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent } from '../../components/ui/card.js';
import { TableCell, TableRow } from '../../components/ui/table.js';
import { formatContentRelativeTimestamp } from './workspace-content-browser-support.js';

export function DocumentCard(props: {
  document: DashboardResolvedDocumentReference;
  workflowId: string;
  activeLogicalName?: string | null;
  deletingLogicalName?: string | null;
  onEdit?(document: DashboardResolvedDocumentReference): void;
  onDelete?(document: DashboardResolvedDocumentReference): void;
}): JSX.Element {
  return (
    <Card className="border-border/70 bg-card/70">
      <CardContent className="space-y-4 pt-5">
        <DocumentIdentity document={props.document} />
        <DocumentSourcePacket document={props.document} />
        <div className="flex flex-wrap items-center gap-2">
          {props.onEdit ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => props.onEdit?.(props.document)}
              disabled={props.deletingLogicalName === props.document.logical_name}
            >
              {props.activeLogicalName === props.document.logical_name ? 'Editing' : 'Edit'}
            </Button>
          ) : null}
          {props.onDelete ? (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => props.onDelete?.(props.document)}
              disabled={props.deletingLogicalName === props.document.logical_name}
            >
              {props.deletingLogicalName === props.document.logical_name ? 'Deleting…' : 'Delete'}
            </Button>
          ) : null}
          <Link
            className="text-sm text-accent hover:underline"
            to={`/work/boards/${props.workflowId}`}
          >
            Open workflow
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

export function DocumentDesktopRow(props: {
  document: DashboardResolvedDocumentReference;
  workflowId: string;
  activeLogicalName?: string | null;
  deletingLogicalName?: string | null;
  onEdit?(document: DashboardResolvedDocumentReference): void;
  onDelete?(document: DashboardResolvedDocumentReference): void;
}): JSX.Element {
  return (
    <TableRow>
      <TableCell className="min-w-[280px] align-top">
        <DocumentIdentity document={props.document} />
      </TableCell>
      <TableCell className="min-w-[280px] align-top">
        <DocumentSourcePacket document={props.document} />
      </TableCell>
      <TableCell className="align-top text-sm text-muted-foreground">
        <span title={formatAbsoluteTimestamp(props.document.created_at)}>
          {formatContentRelativeTimestamp(props.document.created_at)}
        </span>
      </TableCell>
      <TableCell className="align-top">
        <div className="flex flex-wrap items-center gap-2">
          {props.onEdit ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => props.onEdit?.(props.document)}
              disabled={props.deletingLogicalName === props.document.logical_name}
            >
              {props.activeLogicalName === props.document.logical_name ? 'Editing' : 'Edit'}
            </Button>
          ) : null}
          {props.onDelete ? (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => props.onDelete?.(props.document)}
              disabled={props.deletingLogicalName === props.document.logical_name}
            >
              {props.deletingLogicalName === props.document.logical_name ? 'Deleting…' : 'Delete'}
            </Button>
          ) : null}
          <Link
            className="text-sm text-accent hover:underline"
            to={`/work/boards/${props.workflowId}`}
          >
            Open workflow
          </Link>
        </div>
      </TableCell>
    </TableRow>
  );
}

function DocumentIdentity(props: { document: DashboardResolvedDocumentReference }): JSX.Element {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{props.document.source}</Badge>
        <Badge variant="secondary">{props.document.scope}</Badge>
        {props.document.metadata && Object.keys(props.document.metadata).length > 0 ? (
          <Badge variant="outline">
            {Object.keys(props.document.metadata).length} metadata fields
          </Badge>
        ) : null}
      </div>
      <div>
        <p className="text-sm font-semibold">
          {props.document.title ?? props.document.logical_name}
        </p>
        <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
          {props.document.logical_name}
        </p>
        {props.document.description ? (
          <p className="mt-2 text-sm text-muted-foreground">{props.document.description}</p>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            Add a short description so operators can scan purpose without opening the record.
          </p>
        )}
      </div>
    </div>
  );
}

function DocumentSourcePacket(props: {
  document: DashboardResolvedDocumentReference;
}): JSX.Element {
  return (
    <div className="space-y-2 rounded-xl border border-border/70 bg-background/70 p-3">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
        Source packet
      </p>
      <p className="text-sm font-medium">{describeDocumentSource(props.document)}</p>
      <p className="text-xs text-muted-foreground">
        Added {formatContentRelativeTimestamp(props.document.created_at)}
      </p>
    </div>
  );
}

function describeDocumentSource(document: DashboardResolvedDocumentReference): string {
  if (document.source === 'repository') {
    return (
      [document.repository, document.path].filter(Boolean).join(' • ') ||
      'Repository-backed document'
    );
  }
  if (document.source === 'artifact') {
    return document.artifact?.logical_path ?? document.logical_name;
  }
  return document.url ?? 'External reference';
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
