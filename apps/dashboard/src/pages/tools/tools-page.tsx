import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Wrench } from 'lucide-react';

import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table.js';
import { dashboardApi } from '../../lib/api.js';
import {
  describeToolCategory,
  describeToolOwner,
  summarizeTools,
  type ToolTag,
} from './tools-page.support.js';
import {
  ToolTagDeleteDialog,
  ToolTagEditorDialog,
  createEmptyToolTagDraft,
} from './tools-page.dialogs.js';

export function ToolsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const { data = [], isLoading, error } = useQuery({
    queryKey: ['tools'],
    queryFn: () => dashboardApi.listToolTags(),
  });
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorDraft, setEditorDraft] = useState(createEmptyToolTagDraft());
  const [editorError, setEditorError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ToolTag | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const summaryCards = useMemo(() => summarizeTools(data), [data]);
  const updateMutation = useMutation({
    mutationFn: () =>
      dashboardApi.updateToolTag(editorDraft.id, {
        name: editorDraft.name.trim(),
        description: editorDraft.description.trim(),
        category: editorDraft.category,
      }),
    onSuccess: async () => {
      setEditorError(null);
      setEditorOpen(false);
      setEditorDraft(createEmptyToolTagDraft());
      await queryClient.invalidateQueries({ queryKey: ['tools'] });
    },
    onError: (mutationError) => {
      setEditorError(
        mutationError instanceof Error ? mutationError.message : 'Failed to update tool tag.',
      );
    },
  });
  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!deleteTarget) {
        throw new Error('Choose a tool tag before deleting it.');
      }
      await dashboardApi.deleteToolTag(deleteTarget.id);
    },
    onSuccess: async () => {
      setDeleteError(null);
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['tools'] });
    },
    onError: (mutationError) => {
      setDeleteError(
        mutationError instanceof Error ? mutationError.message : 'Failed to delete tool tag.',
      );
    },
  });

  function openEditDialog(tool: ToolTag): void {
    setEditorDraft({
      id: tool.id,
      name: tool.name,
      description: tool.description ?? '',
      category: (tool.category as typeof editorDraft.category | null) ?? 'files',
    });
    setEditorError(null);
    setEditorOpen(true);
  }

  if (isLoading) {
    return <div className="flex items-center justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;
  }
  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
          Failed to load tools: {String(error)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Wrench className="h-5 w-5 text-accent" />
          <h1 className="text-2xl font-semibold">Tools</h1>
        </div>
        <p className="max-w-3xl text-sm text-muted">
          Built-in tools available to agents. Use the Roles page to control which tools each role can access.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {summaryCards.map((summary) => (
          <Card key={summary.label} className="border-border/70 shadow-sm">
            <CardHeader className="space-y-1">
              <p className="text-sm font-medium text-muted">{summary.label}</p>
              <CardTitle className="text-2xl">{summary.value}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted">{summary.detail}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {data.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center text-muted">
            <Wrench className="h-12 w-12" />
            <p className="font-medium text-foreground">No tools registered</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border/70 shadow-sm">
          <CardHeader>
            <CardTitle>Tool catalog</CardTitle>
            <CardDescription>
              {data.length} built-in tools across {new Set(data.map((t) => t.category).filter(Boolean)).size} categories.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((tool) => {
                  const category = describeToolCategory(tool.category);
                  const owner = describeToolOwner(tool.owner);
                  return (
                    <TableRow key={tool.id}>
                      <TableCell className="font-mono text-sm">{tool.id}</TableCell>
                      <TableCell className="font-medium">{tool.name}</TableCell>
                      <TableCell>
                        <Badge variant={category.badgeVariant}>{category.label}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <Badge variant={owner.badgeVariant}>{owner.label}</Badge>
                          <p className="text-xs text-muted">{owner.detail}</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted">
                        {tool.description?.trim() || '—'}
                      </TableCell>
                      <TableCell className="min-w-[14rem]">
                        {tool.is_built_in ? (
                          <div className="space-y-1">
                            <Badge variant="outline">Built-in</Badge>
                            <p className="text-xs text-muted">Built-in tools are read-only</p>
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            <Button variant="outline" size="sm" onClick={() => openEditDialog(tool)}>
                              Edit Tool Tag
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => {
                                setDeleteError(null);
                                setDeleteTarget(tool);
                              }}
                            >
                              Delete Tool Tag
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      <ToolTagEditorDialog
        isOpen={editorOpen}
        mode="edit"
        draft={editorDraft}
        error={editorError}
        isPending={updateMutation.isPending}
        onOpenChange={(open) => {
          setEditorOpen(open);
          if (!open) {
            setEditorDraft(createEmptyToolTagDraft());
            setEditorError(null);
          }
        }}
        onDraftChange={setEditorDraft}
        onSubmit={() => updateMutation.mutate()}
      />
      <ToolTagDeleteDialog
        isOpen={deleteTarget !== null}
        toolName={deleteTarget?.name ?? deleteTarget?.id ?? 'this tool tag'}
        error={deleteError}
        isPending={deleteMutation.isPending}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        }}
        onSubmit={() => deleteMutation.mutate()}
      />
    </div>
  );
}
