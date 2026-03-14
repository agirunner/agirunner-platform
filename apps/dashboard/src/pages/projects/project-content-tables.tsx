import { FileText, Package } from 'lucide-react';

import type {
  DashboardResolvedDocumentReference,
  DashboardTaskArtifactRecord,
} from '../../lib/api.js';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '../../components/ui/table.js';
import { ArtifactCard, ArtifactDesktopRow } from './project-content-artifact-records.js';
import { DocumentCard, DocumentDesktopRow } from './project-content-document-records.js';

interface DocumentsTableProps {
  documents: DashboardResolvedDocumentReference[];
  isLoading: boolean;
  workflowId: string;
  activeLogicalName?: string | null;
  deletingLogicalName?: string | null;
  onEdit?(document: DashboardResolvedDocumentReference): void;
  onDelete?(document: DashboardResolvedDocumentReference): void;
}

interface ArtifactsTableProps {
  artifacts: DashboardTaskArtifactRecord[];
  isLoading: boolean;
  taskId: string;
  buildPreviewHref?(artifact: DashboardTaskArtifactRecord): string;
  deletingArtifactId?: string | null;
  onDelete?(artifact: DashboardTaskArtifactRecord): void;
}

export function DocumentsTable(props: DocumentsTableProps): JSX.Element {
  if (props.isLoading) {
    return <CenteredLoader />;
  }

  if (props.documents.length === 0) {
    return (
      <EmptyState
        icon={<FileText className="mb-3 h-10 w-10" />}
        title="No documents found"
        message="This workflow has not published any resolved documents yet."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:hidden">
        {props.documents.map((document) => (
          <DocumentCard
            key={document.logical_name}
            activeLogicalName={props.activeLogicalName}
            deletingLogicalName={props.deletingLogicalName}
            document={document}
            workflowId={props.workflowId}
            onDelete={props.onDelete}
            onEdit={props.onEdit}
          />
        ))}
      </div>
      <div className="hidden overflow-x-auto lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Document</TableHead>
              <TableHead>Source packet</TableHead>
              <TableHead>Added</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {props.documents.map((document) => (
              <DocumentDesktopRow
                key={document.logical_name}
                activeLogicalName={props.activeLogicalName}
                deletingLogicalName={props.deletingLogicalName}
                document={document}
                workflowId={props.workflowId}
                onDelete={props.onDelete}
                onEdit={props.onEdit}
              />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export function ArtifactsTable(props: ArtifactsTableProps): JSX.Element {
  if (props.isLoading) {
    return <CenteredLoader />;
  }

  if (props.artifacts.length === 0) {
    return (
      <EmptyState
        icon={<Package className="mb-3 h-10 w-10" />}
        title="No artifacts found"
        message="This task has not uploaded any artifacts yet."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:hidden">
        {props.artifacts.map((artifact) => (
          <ArtifactCard
            key={artifact.id}
            artifact={artifact}
            previewHref={props.buildPreviewHref?.(artifact)}
            deletingArtifactId={props.deletingArtifactId}
            onDelete={props.onDelete}
          />
        ))}
      </div>
      <div className="hidden overflow-x-auto lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Artifact</TableHead>
              <TableHead>Delivery packet</TableHead>
              <TableHead>Added</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {props.artifacts.map((artifact) => (
              <ArtifactDesktopRow
                key={artifact.id}
                artifact={artifact}
                taskId={props.taskId}
                previewHref={props.buildPreviewHref?.(artifact)}
                deletingArtifactId={props.deletingArtifactId}
                onDelete={props.onDelete}
              />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function CenteredLoader(): JSX.Element {
  return (
    <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
      Loading…
    </div>
  );
}

function EmptyState(props: { icon: JSX.Element; title: string; message: string }): JSX.Element {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-border/70 py-12 text-center text-muted-foreground">
      {props.icon}
      <p className="font-medium">{props.title}</p>
      <p className="mt-1 max-w-md text-sm">{props.message}</p>
    </div>
  );
}
