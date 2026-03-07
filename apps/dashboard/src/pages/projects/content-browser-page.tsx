import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, FileText, Package, Download } from 'lucide-react';
import {
  dashboardApi,
  type DashboardProjectRecord,
  type DashboardResolvedDocumentReference,
  type DashboardTaskArtifactRecord,
} from '../../lib/api.js';
import { Badge } from '../../components/ui/badge.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../../components/ui/table.js';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs.js';

function normalizeProjectList(
  response: { data: DashboardProjectRecord[] } | DashboardProjectRecord[] | undefined,
): DashboardProjectRecord[] {
  if (!response) return [];
  if (Array.isArray(response)) return response;
  return response?.data ?? [];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString();
}

function DocumentsTable({
  documents,
  isLoading,
}: {
  documents: DashboardResolvedDocumentReference[];
  isLoading: boolean;
}): JSX.Element {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <div className="flex flex-col items-center py-12 text-muted-foreground">
        <FileText className="h-10 w-10 mb-3" />
        <p className="font-medium">No documents found</p>
        <p className="text-sm mt-1">Documents will appear after workflows produce output.</p>
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
        {documents.map((doc, idx) => (
          <TableRow key={`${doc.logical_name}-${idx}`}>
            <TableCell className="font-medium">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="truncate max-w-[300px]">{doc.title ?? doc.logical_name}</span>
              </div>
            </TableCell>
            <TableCell>
              <Badge variant="outline">{doc.source}</Badge>
            </TableCell>
            <TableCell>
              <Badge variant="secondary">{doc.scope}</Badge>
            </TableCell>
            <TableCell className="text-muted-foreground">{formatDate(doc.created_at)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ArtifactsTable({
  artifacts,
  isLoading,
}: {
  artifacts: DashboardTaskArtifactRecord[];
  isLoading: boolean;
}): JSX.Element {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (artifacts.length === 0) {
    return (
      <div className="flex flex-col items-center py-12 text-muted-foreground">
        <Package className="h-10 w-10 mb-3" />
        <p className="font-medium">No artifacts found</p>
        <p className="text-sm mt-1">Artifacts will appear after tasks produce output.</p>
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
          <TableHead>Download</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {artifacts.map((artifact) => (
          <TableRow key={artifact.id}>
            <TableCell className="font-medium">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="truncate max-w-[300px] font-mono text-sm">{artifact.logical_path}</span>
              </div>
            </TableCell>
            <TableCell>
              <Badge variant="outline">{artifact.content_type}</Badge>
            </TableCell>
            <TableCell className="text-muted-foreground">{formatBytes(artifact.size_bytes)}</TableCell>
            <TableCell className="text-muted-foreground">{formatDate(artifact.created_at)}</TableCell>
            <TableCell>
              <a
                href={artifact.download_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-accent hover:underline"
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </a>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function ContentBrowserPage(): JSX.Element {
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [workflowIdInput, setWorkflowIdInput] = useState('');
  const [taskIdInput, setTaskIdInput] = useState('');

  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: () => dashboardApi.listProjects(),
  });

  const projects = normalizeProjectList(projectsQuery.data);

  const documentsQuery = useQuery({
    queryKey: ['content-documents', selectedProjectId, workflowIdInput],
    queryFn: async () => {
      if (workflowIdInput.trim()) {
        return dashboardApi.listWorkflowDocuments(workflowIdInput.trim());
      }
      const timeline = await dashboardApi.getProjectTimeline(selectedProjectId);
      const allDocs: DashboardResolvedDocumentReference[] = [];
      const docPromises = timeline.slice(0, 10).map(async (entry) => {
        try {
          const docs = await dashboardApi.listWorkflowDocuments(entry.workflow_id);
          allDocs.push(...docs);
        } catch {
          /* workflow may not have documents */
        }
      });
      await Promise.allSettled(docPromises);
      return allDocs;
    },
    enabled: selectedProjectId.length > 0,
  });

  const artifactsQuery = useQuery({
    queryKey: ['content-artifacts', taskIdInput],
    queryFn: () => dashboardApi.listTaskArtifacts(taskIdInput.trim()),
    enabled: taskIdInput.trim().length > 0,
  });

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Content Browser</h1>
        <p className="text-sm text-muted-foreground">
          Browse documents and artifacts produced by project workflows.
        </p>
      </div>

      <div className="max-w-xs">
        <label className="text-sm font-medium mb-1 block">Project</label>
        {projectsQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading projects...
          </div>
        ) : (
          <Select
            value={selectedProjectId}
            onValueChange={(v) => {
              setSelectedProjectId(v);
              setWorkflowIdInput('');
              setTaskIdInput('');
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a project" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {projectsQuery.error && (
        <p className="text-sm text-red-600">Failed to load projects.</p>
      )}

      {!selectedProjectId && !projectsQuery.isLoading && (
        <div className="flex flex-col items-center py-12 text-muted-foreground">
          <Package className="h-12 w-12 mb-4" />
          <p className="font-medium">Select a project to browse content</p>
        </div>
      )}

      {selectedProjectId && (
        <Tabs defaultValue="documents">
          <TabsList>
            <TabsTrigger value="documents">Documents</TabsTrigger>
            <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
          </TabsList>

          <TabsContent value="documents" className="space-y-4">
            <div className="max-w-sm">
              <label htmlFor="workflow-id-filter" className="text-xs font-medium text-muted-foreground">
                Workflow ID (optional filter)
              </label>
              <Input
                id="workflow-id-filter"
                value={workflowIdInput}
                onChange={(e) => setWorkflowIdInput(e.target.value)}
                placeholder="Filter by workflow ID"
                className="mt-1"
              />
            </div>
            {documentsQuery.error && (
              <p className="text-sm text-red-600">Failed to load documents.</p>
            )}
            <DocumentsTable
              documents={documentsQuery.data ?? []}
              isLoading={documentsQuery.isLoading}
            />
          </TabsContent>

          <TabsContent value="artifacts" className="space-y-4">
            <div className="max-w-sm">
              <label htmlFor="task-id-filter" className="text-xs font-medium text-muted-foreground">
                Task ID
              </label>
              <Input
                id="task-id-filter"
                value={taskIdInput}
                onChange={(e) => setTaskIdInput(e.target.value)}
                placeholder="Enter a task ID to view artifacts"
                className="mt-1"
              />
            </div>
            {artifactsQuery.error && (
              <p className="text-sm text-red-600">Failed to load artifacts.</p>
            )}
            <ArtifactsTable
              artifacts={artifactsQuery.data ?? []}
              isLoading={artifactsQuery.isLoading && taskIdInput.trim().length > 0}
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
