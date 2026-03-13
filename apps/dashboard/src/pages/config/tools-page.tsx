import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Wrench } from 'lucide-react';

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
import { readSession } from '../../lib/session.js';
import { toast } from '../../lib/toast.js';
import {
  createToolIdFromName,
  describeToolCategory,
  summarizeTools,
  type CreateToolForm,
  type ToolTag,
  validateCreateToolForm,
} from './tools-page.support.js';
import { CreateToolDialog } from './tools-page.dialog.js';

const API_BASE_URL = import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';
const INITIAL_FORM: CreateToolForm = { id: '', name: '', description: '', category: 'runtime' };

function getAuthHeaders(): Record<string, string> {
  const session = readSession();
  return {
    'Content-Type': 'application/json',
    ...(session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {}),
  };
}

async function fetchTools(): Promise<ToolTag[]> {
  const response = await fetch(`${API_BASE_URL}/api/v1/tools`, {
    headers: getAuthHeaders(),
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const body = await response.json();
  return body.data ?? body;
}

async function createTool(payload: CreateToolForm): Promise<ToolTag> {
  const response = await fetch(`${API_BASE_URL}/api/v1/tools`, {
    method: 'POST',
    headers: getAuthHeaders(),
    credentials: 'include',
    body: JSON.stringify({
      id: payload.id.trim(),
      name: payload.name.trim(),
      description: payload.description.trim() || undefined,
      category: payload.category,
    }),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const body = await response.json();
  return body.data ?? body;
}

export function ToolsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const { data = [], isLoading, error } = useQuery({ queryKey: ['tools'], queryFn: fetchTools });
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState<CreateToolForm>(INITIAL_FORM);
  const [hasCustomId, setHasCustomId] = useState(false);
  const summaryCards = useMemo(() => summarizeTools(data), [data]);
  const validation = useMemo(() => validateCreateToolForm(form, data), [form, data]);

  const mutation = useMutation({
    mutationFn: () => createTool(form),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['tools'] });
      setForm(INITIAL_FORM);
      setHasCustomId(false);
      setIsOpen(false);
      toast.success('Tool created');
    },
    onError: (errorValue) => {
      const message = errorValue instanceof Error ? errorValue.message : 'Failed to create tool';
      toast.error(message);
    },
  });

  function resetDialog(): void {
    setForm(INITIAL_FORM);
    setHasCustomId(false);
  }

  function openDialog(nextOpen: boolean): void {
    setIsOpen(nextOpen);
    if (!nextOpen) {
      resetDialog();
    }
  }

  function updateName(value: string): void {
    setForm((current) => ({
      ...current,
      name: value,
      id: hasCustomId ? current.id : createToolIdFromName(value),
    }));
  }

  if (isLoading) {
    return <div className="flex items-center justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;
  }
  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Failed to load tools: {String(error)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <Card>
        <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Wrench className="h-5 w-5 text-muted" />
              <CardTitle className="text-2xl">Tools</CardTitle>
            </div>
            <CardDescription className="max-w-3xl text-sm leading-6">
              Manage the shared tool catalog available to roles and agents. Keep names, categories,
              and descriptions consistent so operators know what they are granting before execution.
            </CardDescription>
          </div>
          <Button onClick={() => setIsOpen(true)} data-testid="add-tool">
            <Plus className="h-4 w-4" />
            Add Tool
          </Button>
        </CardHeader>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        {summaryCards.map((summary) => (
          <Card key={summary.label} className="border-border/70 shadow-sm">
            <CardHeader className="space-y-1">
              <p className="text-sm font-medium text-muted">{summary.label}</p>
              <CardTitle className="text-2xl">{summary.value}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-6 text-muted">{summary.detail}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {data.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center text-muted">
            <Wrench className="h-12 w-12" />
            <div className="space-y-1">
              <p className="font-medium text-foreground">No tools registered</p>
              <p className="text-sm">Add the first tool to make it available to roles and agent workflows.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border/70 shadow-sm">
          <CardHeader className="space-y-2">
            <CardTitle>Tool catalog</CardTitle>
            <CardDescription>
              Review tool posture at a glance, then use the category and description to confirm it
              should be granted into runtime execution.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-4 lg:hidden">
              {data.map((tool) => {
                const category = describeToolCategory(tool.category);
                return (
                  <Card key={tool.id} className="border-border/70 bg-muted/10 shadow-none">
                    <CardHeader className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <CardTitle className="text-base">{tool.name}</CardTitle>
                        <Badge variant={category.badgeVariant}>{category.label}</Badge>
                      </div>
                      <p className="font-mono text-xs text-muted">{tool.id}</p>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <p className="text-foreground">{tool.description?.trim() || 'No description yet.'}</p>
                      <p className="text-muted">{category.detail}</p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <div className="hidden overflow-x-auto lg:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((tool) => {
                    const category = describeToolCategory(tool.category);
                    return (
                      <TableRow key={tool.id}>
                        <TableCell className="font-mono text-sm">{tool.id}</TableCell>
                        <TableCell className="font-medium">{tool.name}</TableCell>
                        <TableCell>
                          <Badge variant={category.badgeVariant}>{category.label}</Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted">
                          {tool.description?.trim() || 'No description yet.'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <CreateToolDialog
        open={isOpen}
        form={form}
        validation={validation}
        isPending={mutation.isPending}
        onOpenChange={openDialog}
        onSubmit={() => mutation.mutate()}
        onNameChange={updateName}
        onIdChange={(value) => {
          setHasCustomId(true);
          setForm((current) => ({ ...current, id: value }));
        }}
        onDescriptionChange={(value) =>
          setForm((current) => ({ ...current, description: value }))
        }
        onCategoryChange={(value) =>
          setForm((current) => ({ ...current, category: value }))
        }
      />
    </div>
  );
}
