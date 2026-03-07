import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import {
  Loader2,
  Plus,
  Trash2,
  Save,
  Code2,
  FileText,
  Calendar,
} from 'lucide-react';
import { dashboardApi } from '../../lib/api.js';
import type {
  DashboardProjectRecord,
  DashboardProjectSpecRecord,
  DashboardProjectResourceRecord,
  DashboardProjectToolCatalog,
  DashboardProjectTimelineEntry,
} from '../../lib/api.js';
import { cn } from '../../lib/utils.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Input } from '../../components/ui/input.js';
import { Textarea } from '../../components/ui/textarea.js';
import { Switch } from '../../components/ui/switch.js';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../../components/ui/table.js';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '../../components/ui/tabs.js';

/* ------------------------------------------------------------------ */
/*  Spec Tab                                                           */
/* ------------------------------------------------------------------ */

function SpecTab({ projectId }: { projectId: string }): JSX.Element {
  const [isRawJson, setIsRawJson] = useState(false);
  const [editedJson, setEditedJson] = useState('');
  const [hasEdits, setHasEdits] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['project-spec', projectId],
    queryFn: () => dashboardApi.getProjectSpec(projectId),
  });

  if (isLoading) {
    return <LoadingCard />;
  }

  if (error) {
    return <ErrorCard message="Failed to load project spec." />;
  }

  const spec = data as DashboardProjectSpecRecord;
  const jsonString = JSON.stringify(spec, null, 2);

  function handleJsonEdit(value: string) {
    setEditedJson(value);
    setHasEdits(true);
  }

  if (isRawJson) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={() => setIsRawJson(false)}>
            <FileText className="h-4 w-4" />
            Form View
          </Button>
          {hasEdits && (
            <Button size="sm" disabled>
              <Save className="h-4 w-4" />
              Save (read-only)
            </Button>
          )}
        </div>
        <Card>
          <CardContent className="p-0">
            <Textarea
              className="min-h-[400px] font-mono text-xs border-0 rounded-lg"
              value={hasEdits ? editedJson : jsonString}
              onChange={(e) => handleJsonEdit(e.target.value)}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button variant="outline" size="sm" onClick={() => { setIsRawJson(true); setEditedJson(jsonString); }}>
          <Code2 className="h-4 w-4" />
          Raw JSON
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <FieldRow label="Project ID" value={spec.project_id} />
          <FieldRow label="Version" value={spec.version !== undefined ? String(spec.version) : '-'} />
          <FieldRow
            label="Updated"
            value={spec.updated_at ? new Date(spec.updated_at).toLocaleString() : '-'}
          />
        </CardContent>
      </Card>

      {spec.config && Object.keys(spec.config).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Config</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded-md border bg-border/10 p-3 text-xs">
              {JSON.stringify(spec.config, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      {spec.instructions && Object.keys(spec.instructions).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Instructions</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded-md border bg-border/10 p-3 text-xs">
              {JSON.stringify(spec.instructions, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Resources Tab                                                      */
/* ------------------------------------------------------------------ */

function ResourcesTab({ projectId }: { projectId: string }): JSX.Element {
  const { data, isLoading, error } = useQuery({
    queryKey: ['project-resources', projectId],
    queryFn: () => dashboardApi.listProjectResources(projectId),
  });

  if (isLoading) return <LoadingCard />;
  if (error) return <ErrorCard message="Failed to load resources." />;

  const resources = (data?.data ?? []) as DashboardProjectResourceRecord[];

  if (resources.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted">
          No resources defined for this project.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Metadata</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {resources.map((r, idx) => (
              <TableRow key={r.id ?? idx}>
                <TableCell className="font-medium">{r.name ?? r.id ?? '-'}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{r.type ?? '-'}</Badge>
                </TableCell>
                <TableCell className="max-w-xs truncate text-sm">{r.description ?? '-'}</TableCell>
                <TableCell>
                  {r.metadata && Object.keys(r.metadata).length > 0 ? (
                    <pre className="max-w-xs truncate text-xs">
                      {JSON.stringify(r.metadata)}
                    </pre>
                  ) : (
                    '-'
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Tools Tab                                                          */
/* ------------------------------------------------------------------ */

interface ToolEntry {
  name: string;
  isBlocked: boolean;
  data: unknown;
}

function ToolsTab({ projectId }: { projectId: string }): JSX.Element {
  const { data, isLoading, error } = useQuery({
    queryKey: ['project-tools', projectId],
    queryFn: () => dashboardApi.listProjectTools(projectId),
  });

  if (isLoading) return <LoadingCard />;
  if (error) return <ErrorCard message="Failed to load tools." />;

  const catalog = (data?.data ?? {}) as DashboardProjectToolCatalog;
  const availableTools = Array.isArray(catalog.available) ? catalog.available : [];
  const blockedTools = Array.isArray(catalog.blocked) ? catalog.blocked : [];

  const tools: ToolEntry[] = [
    ...availableTools.map((t) => ({
      name: typeof t === 'object' && t !== null && 'name' in t ? String((t as { name: string }).name) : String(t),
      isBlocked: false,
      data: t,
    })),
    ...blockedTools.map((t) => ({
      name: typeof t === 'object' && t !== null && 'name' in t ? String((t as { name: string }).name) : String(t),
      isBlocked: true,
      data: t,
    })),
  ];

  if (tools.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted">
          No tools configured for this project.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tool</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Toggle</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tools.map((tool) => (
              <TableRow key={tool.name}>
                <TableCell className="font-medium">{tool.name}</TableCell>
                <TableCell>
                  <Badge variant={tool.isBlocked ? 'destructive' : 'success'}>
                    {tool.isBlocked ? 'Blocked' : 'Available'}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Switch checked={!tool.isBlocked} disabled />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Timeline Tab                                                       */
/* ------------------------------------------------------------------ */

function TimelineTab({ projectId }: { projectId: string }): JSX.Element {
  const { data, isLoading, error } = useQuery({
    queryKey: ['project-timeline', projectId],
    queryFn: () => dashboardApi.getProjectTimeline(projectId),
  });

  if (isLoading) return <LoadingCard />;
  if (error) return <ErrorCard message="Failed to load timeline." />;

  const entries = (data ?? []) as DashboardProjectTimelineEntry[];

  if (entries.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted">
          No timeline entries for this project.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="relative space-y-0">
          {entries.map((entry, idx) => {
            const stateVariant = statusBadgeVariant(entry.state);
            return (
              <div key={entry.workflow_id} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div className="h-3 w-3 rounded-full border-2 border-accent bg-surface" />
                  {idx < entries.length - 1 && <div className="w-0.5 flex-1 bg-border" />}
                </div>
                <div className="pb-6 flex-1">
                  <div className="flex items-center gap-2">
                    <Link
                      to={`/work/workflows/${entry.workflow_id}`}
                      className="text-sm font-medium text-accent hover:underline"
                    >
                      {entry.name}
                    </Link>
                    <Badge variant={stateVariant} className="capitalize text-[10px]">
                      {entry.state}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted">
                    <Calendar className="mr-1 inline h-3 w-3" />
                    {new Date(entry.created_at).toLocaleString()}
                    {entry.duration_seconds !== undefined && entry.duration_seconds !== null && (
                      <span className="ml-2">
                        Duration: {formatDuration(entry.duration_seconds)}
                      </span>
                    )}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Memory Tab                                                         */
/* ------------------------------------------------------------------ */

function MemoryTab({ projectId }: { projectId: string }): JSX.Element {
  const queryClient = useQueryClient();
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => dashboardApi.getProject(projectId),
  });

  const patchMutation = useMutation({
    mutationFn: (payload: { key: string; value: unknown }) =>
      dashboardApi.patchProjectMemory(projectId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    },
  });

  if (isLoading) return <LoadingCard />;

  const memory = (data?.memory ?? {}) as Record<string, unknown>;

  function handleAdd() {
    if (!newKey.trim()) return;
    let parsedValue: unknown = newValue;
    try {
      parsedValue = JSON.parse(newValue);
    } catch {
      /* use raw string */
    }
    patchMutation.mutate({ key: newKey.trim(), value: parsedValue });
    setNewKey('');
    setNewValue('');
  }

  function handleDelete(key: string) {
    patchMutation.mutate({ key, value: null });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Memory Entries</CardTitle>
        </CardHeader>
        <CardContent>
          {Object.keys(memory).length === 0 ? (
            <p className="text-sm text-muted">No memory entries.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Key</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(memory).map(([key, value]) => (
                  <TableRow key={key}>
                    <TableCell className="font-mono text-sm">{key}</TableCell>
                    <TableCell>
                      <pre className="max-w-md truncate text-xs">
                        {typeof value === 'string' ? value : JSON.stringify(value)}
                      </pre>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(key)}
                        disabled={patchMutation.isPending}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Add Entry</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-1">
              <label className="text-xs font-medium">Key</label>
              <Input
                placeholder="my_key"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
              />
            </div>
            <div className="flex-1 space-y-1">
              <label className="text-xs font-medium">Value (string or JSON)</label>
              <Input
                placeholder='"value" or {"key": "val"}'
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
              />
            </div>
            <Button size="sm" onClick={handleAdd} disabled={patchMutation.isPending || !newKey.trim()}>
              <Plus className="h-4 w-4" />
              Add
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared helpers                                                     */
/* ------------------------------------------------------------------ */

function LoadingCard(): JSX.Element {
  return (
    <Card>
      <CardContent className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted" />
      </CardContent>
    </Card>
  );
}

function ErrorCard({ message }: { message: string }): JSX.Element {
  return (
    <Card>
      <CardContent className="py-4 text-sm text-red-600">{message}</CardContent>
    </Card>
  );
}

function FieldRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-center gap-4">
      <span className="w-28 text-sm text-muted">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

function formatDuration(seconds?: number | null): string {
  if (seconds === undefined || seconds === null) return '-';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60);
  return `${minutes}m ${remaining}s`;
}

function statusBadgeVariant(status: string) {
  const map: Record<string, 'success' | 'default' | 'destructive' | 'warning' | 'secondary'> = {
    completed: 'success',
    running: 'default',
    failed: 'destructive',
    paused: 'warning',
    pending: 'secondary',
  };
  return map[status] ?? 'secondary';
}

/* ------------------------------------------------------------------ */
/*  Main page                                                          */
/* ------------------------------------------------------------------ */

export function ProjectDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading, error } = useQuery({
    queryKey: ['project', id],
    queryFn: () => dashboardApi.getProject(id!),
    enabled: Boolean(id),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-red-600">Failed to load project. Please try again later.</div>
    );
  }

  const project = data as DashboardProjectRecord;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{project.name}</h1>
          {project.description && (
            <p className="mt-1 text-sm text-muted">{project.description}</p>
          )}
        </div>
        <Badge variant={project.is_active ? 'success' : 'secondary'}>
          {project.is_active ? 'Active' : 'Inactive'}
        </Badge>
      </div>

      <Tabs defaultValue="spec">
        <TabsList>
          <TabsTrigger value="spec">Spec</TabsTrigger>
          <TabsTrigger value="resources">Resources</TabsTrigger>
          <TabsTrigger value="tools">Tools</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="memory">Memory</TabsTrigger>
        </TabsList>

        <TabsContent value="spec">
          <SpecTab projectId={project.id} />
        </TabsContent>

        <TabsContent value="resources">
          <ResourcesTab projectId={project.id} />
        </TabsContent>

        <TabsContent value="tools">
          <ToolsTab projectId={project.id} />
        </TabsContent>

        <TabsContent value="timeline">
          <TimelineTab projectId={project.id} />
        </TabsContent>

        <TabsContent value="memory">
          <MemoryTab projectId={project.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
