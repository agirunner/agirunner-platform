import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Pencil, Trash2, Save, X, BrainCircuit } from 'lucide-react';
import { dashboardApi, type DashboardProjectRecord } from '../../lib/api.js';
import { Button } from '../../components/ui/button.js';
import { Badge } from '../../components/ui/badge.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs.js';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../../components/ui/table.js';

type MemoryScope = 'global' | 'project' | 'workflow' | 'task';

interface MemoryEntry {
  key: string;
  value: unknown;
  scope: MemoryScope;
}

function truncateValue(value: unknown, maxLength: number): string {
  const stringified = typeof value === 'string' ? value : JSON.stringify(value);
  if (stringified.length <= maxLength) return stringified;
  return `${stringified.slice(0, maxLength)}...`;
}

function extractMemoryEntries(
  memory: Record<string, unknown> | undefined,
  scope: MemoryScope,
): MemoryEntry[] {
  if (!memory) return [];
  return Object.entries(memory).map(([key, value]) => ({
    key,
    value,
    scope,
  }));
}

function MemoryTable({
  entries,
  projectId,
}: {
  entries: MemoryEntry[];
  projectId: string;
}) {
  const queryClient = useQueryClient();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const patchMutation = useMutation({
    mutationFn: (payload: { key: string; value: unknown }) =>
      dashboardApi.patchProjectMemory(projectId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      setEditingKey(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (key: string) =>
      dashboardApi.patchProjectMemory(projectId, { key, value: null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    },
  });

  function startEditing(entry: MemoryEntry) {
    setEditingKey(entry.key);
    setEditValue(
      typeof entry.value === 'string'
        ? entry.value
        : JSON.stringify(entry.value, null, 2),
    );
  }

  function saveEdit(key: string) {
    let parsedValue: unknown;
    try {
      parsedValue = JSON.parse(editValue);
    } catch {
      parsedValue = editValue;
    }
    patchMutation.mutate({ key, value: parsedValue });
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center py-8 text-muted">
        <BrainCircuit className="h-10 w-10 mb-2" />
        <p className="text-sm">No memory entries in this scope.</p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Key</TableHead>
          <TableHead>Value</TableHead>
          <TableHead>Scope</TableHead>
          <TableHead className="w-[120px]">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={entry.key}>
            <TableCell className="font-mono text-sm">{entry.key}</TableCell>
            <TableCell>
              {editingKey === entry.key ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    className="flex-1 font-mono text-xs"
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => saveEdit(entry.key)}
                    disabled={patchMutation.isPending}
                  >
                    <Save className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setEditingKey(null)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <span className="font-mono text-xs text-muted">
                  {truncateValue(entry.value, 80)}
                </span>
              )}
            </TableCell>
            <TableCell>
              <Badge variant="outline">{entry.scope}</Badge>
            </TableCell>
            <TableCell>
              {editingKey !== entry.key && (
                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => startEditing(entry)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => deleteMutation.mutate(entry.key)}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function MemoryBrowserPage(): JSX.Element {
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [activeScope, setActiveScope] = useState<MemoryScope>('project');

  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: () => dashboardApi.listProjects(),
  });

  const projectQuery = useQuery({
    queryKey: ['project', selectedProjectId],
    queryFn: () => dashboardApi.getProject(selectedProjectId),
    enabled: selectedProjectId.length > 0,
  });

  const projects = normalizeProjectList(projectsQuery.data);

  const memoryEntries = extractMemoryEntries(
    projectQuery.data?.memory,
    activeScope,
  );

  const filteredEntries =
    activeScope === 'global'
      ? memoryEntries
      : memoryEntries.filter((e) => e.scope === activeScope);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Memory Browser</h1>
        <p className="text-sm text-muted">
          Browse and edit project memory entries across scopes.
        </p>
      </div>

      <div className="max-w-xs">
        <label className="text-sm font-medium mb-1 block">Project</label>
        {projectsQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading projects...
          </div>
        ) : (
          <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
            <SelectTrigger>
              <SelectValue placeholder="Select a project" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {projectsQuery.error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Failed to load projects: {String(projectsQuery.error)}
        </div>
      )}

      {selectedProjectId && (
        <Tabs
          value={activeScope}
          onValueChange={(v) => setActiveScope(v as MemoryScope)}
        >
          <TabsList>
            <TabsTrigger value="global">Global</TabsTrigger>
            <TabsTrigger value="project">Project</TabsTrigger>
            <TabsTrigger value="workflow">Workflow</TabsTrigger>
            <TabsTrigger value="task">Task</TabsTrigger>
          </TabsList>

          <TabsContent value={activeScope} className="mt-4">
            {projectQuery.isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted" />
              </div>
            ) : projectQuery.error ? (
              <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                Failed to load project memory: {String(projectQuery.error)}
              </div>
            ) : (
              <MemoryTable
                entries={filteredEntries.length > 0 ? filteredEntries : memoryEntries}
                projectId={selectedProjectId}
              />
            )}
          </TabsContent>
        </Tabs>
      )}

      {!selectedProjectId && !projectsQuery.isLoading && (
        <div className="flex flex-col items-center py-12 text-muted">
          <BrainCircuit className="h-12 w-12 mb-4" />
          <p className="font-medium">Select a project to browse memory</p>
        </div>
      )}
    </div>
  );
}

function normalizeProjectList(
  response: { data: DashboardProjectRecord[] } | DashboardProjectRecord[] | undefined,
): DashboardProjectRecord[] {
  if (!response) return [];
  if (Array.isArray(response)) return response;
  return response?.data ?? [];
}
