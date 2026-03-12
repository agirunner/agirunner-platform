import { FileText, Loader2, Package } from 'lucide-react';
import { Link } from 'react-router-dom';

import type {
  DashboardResolvedDocumentReference,
  DashboardTaskArtifactRecord,
} from '../../lib/api.js';
import { buildArtifactPermalink } from '../../components/artifact-preview-support.js';
import { Badge } from '../../components/ui/badge.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table.js';

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr?: string | null): string {
  if (!dateStr) {
    return '-';
  }
  return new Date(dateStr).toLocaleDateString();
}

export function DocumentsTable(props: {
  documents: DashboardResolvedDocumentReference[];
  isLoading: boolean;
  workflowId: string;
}): JSX.Element {
  if (props.isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (props.documents.length === 0) {
    return (
      <div className="flex flex-col items-center py-12 text-muted-foreground">
        <FileText className="mb-3 h-10 w-10" />
        <p className="font-medium">No documents found</p>
        <p className="mt-1 text-sm">This workflow has not published any resolved documents yet.</p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Source</TableHead>
          <TableHead>Created</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.documents.map((doc, index) => (
          <TableRow key={`${doc.logical_name}-${index}`}>
            <TableCell className="font-medium">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="max-w-[320px] truncate">{doc.title ?? doc.logical_name}</span>
              </div>
            </TableCell>
            <TableCell>
              <Badge variant="outline">{doc.source}</Badge>
            </TableCell>
            <TableCell>
              <Badge variant="secondary">{doc.scope}</Badge>
            </TableCell>
            <TableCell className="text-muted-foreground">
              {formatDate(doc.created_at)}
            </TableCell>
          </TableRow>
        ))}
        <TableRow>
          <TableCell colSpan={4}>
            <Link
              className="text-sm text-accent hover:underline"
              to={`/work/workflows/${props.workflowId}`}
            >
              Open workflow details
            </Link>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

export function ArtifactsTable(props: {
  artifacts: DashboardTaskArtifactRecord[];
  isLoading: boolean;
  taskId: string;
}): JSX.Element {
  if (props.isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (props.artifacts.length === 0) {
    return (
      <div className="flex flex-col items-center py-12 text-muted-foreground">
        <Package className="mb-3 h-10 w-10" />
        <p className="font-medium">No artifacts found</p>
        <p className="mt-1 text-sm">This task has not uploaded any artifacts yet.</p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Logical Path</TableHead>
          <TableHead>Content Type</TableHead>
          <TableHead>Size</TableHead>
          <TableHead>Created</TableHead>
          <TableHead>Preview</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.artifacts.map((artifact) => (
          <TableRow key={artifact.id}>
            <TableCell className="font-medium">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="max-w-[320px] truncate font-mono text-sm">
                  {artifact.logical_path}
                </span>
              </div>
            </TableCell>
            <TableCell>
              <Badge variant="outline">{artifact.content_type}</Badge>
            </TableCell>
            <TableCell className="text-muted-foreground">
              {formatBytes(artifact.size_bytes)}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {formatDate(artifact.created_at)}
            </TableCell>
            <TableCell>
              <Link
                className="inline-flex items-center gap-1 text-sm text-accent hover:underline"
                to={buildArtifactPermalink(artifact.task_id, artifact.id)}
              >
                <FileText className="h-3.5 w-3.5" />
                Preview
              </Link>
            </TableCell>
          </TableRow>
        ))}
        <TableRow>
          <TableCell colSpan={5}>
            <Link
              className="text-sm text-accent hover:underline"
              to={`/work/tasks/${props.taskId}`}
            >
              Open task details
            </Link>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}
