import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
  Plus,
  Wrench,
} from 'lucide-react';
import { readSession } from '../../lib/session.js';
import { toast } from '../../lib/toast.js';
import { Button } from '../../components/ui/button.js';
import { Badge } from '../../components/ui/badge.js';
import { Input } from '../../components/ui/input.js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
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

interface ToolTag {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  created_at?: string;
}

interface CreateToolForm {
  id: string;
  name: string;
  description: string;
  category: string;
}

const API_BASE_URL =
  import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';

const CATEGORIES = ['runtime', 'vcs', 'web', 'language', 'integration'] as const;

function getAuthHeaders(): Record<string, string> {
  const session = readSession();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (session?.accessToken) {
    headers.Authorization = `Bearer ${session.accessToken}`;
  }
  return headers;
}

async function fetchTools(): Promise<ToolTag[]> {
  const response = await fetch(`${API_BASE_URL}/api/v1/tools`, {
    headers: getAuthHeaders(),
    credentials: 'include',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  return body.data ?? body;
}

async function createTool(payload: CreateToolForm): Promise<ToolTag> {
  const response = await fetch(`${API_BASE_URL}/api/v1/tools`, {
    method: 'POST',
    headers: getAuthHeaders(),
    credentials: 'include',
    body: JSON.stringify({
      id: payload.id,
      name: payload.name,
      description: payload.description || undefined,
      category: payload.category || undefined,
    }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  return body.data ?? body;
}

const INITIAL_FORM: CreateToolForm = {
  id: '',
  name: '',
  description: '',
  category: 'runtime',
};

function categoryVariant(category?: string | null) {
  const map: Record<string, 'default' | 'secondary' | 'outline' | 'warning' | 'success'> = {
    runtime: 'default',
    vcs: 'secondary',
    web: 'outline',
    language: 'warning',
    integration: 'success',
  };
  return map[category ?? ''] ?? ('outline' as const);
}

function CreateToolDialog(): JSX.Element {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState<CreateToolForm>(INITIAL_FORM);

  const mutation = useMutation({
    mutationFn: () => createTool(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tools'] });
      setForm(INITIAL_FORM);
      setIsOpen(false);
      toast.success('Tool created');
    },
    onError: () => {
      toast.error('Failed to create tool');
    },
  });

  function handleNameChange(value: string): void {
    const id = value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
    setForm((prev) => ({ ...prev, name: value, id }));
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <Button onClick={() => setIsOpen(true)} data-testid="add-tool">
        <Plus className="h-4 w-4" />
        Add Tool
      </Button>
      <DialogContent className="max-h-[75vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Tool</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <div className="space-y-2">
            <label className="text-sm font-medium">Name</label>
            <Input
              placeholder="Code Formatter"
              value={form.name}
              onChange={(e) => handleNameChange(e.target.value)}
              required
              data-testid="tool-name-input"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">ID</label>
            <Input
              placeholder="code_formatter"
              value={form.id}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, id: e.target.value }))
              }
              required
              data-testid="tool-id-input"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Category</label>
            <Select
              value={form.category}
              onValueChange={(v) =>
                setForm((prev) => ({ ...prev, category: v }))
              }
            >
              <SelectTrigger data-testid="tool-category-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Description</label>
            <Input
              placeholder="Optional description"
              value={form.description}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, description: e.target.value }))
              }
              data-testid="tool-description-input"
            />
          </div>
          {mutation.error && (
            <p className="text-sm text-red-600">{String(mutation.error)}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending} data-testid="submit-tool">
              {mutation.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Create
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ToolsPage(): JSX.Element {
  const { data, isLoading, error } = useQuery({
    queryKey: ['tools'],
    queryFn: fetchTools,
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
      <div className="p-6">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Failed to load tools: {String(error)}
        </div>
      </div>
    );
  }

  const tools = Array.isArray(data) ? data : [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Tools</h1>
          <p className="text-sm text-muted">
            Manage tool definitions available to agents during task execution.
          </p>
        </div>
        <CreateToolDialog />
      </div>

      {tools.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted">
          <Wrench className="h-12 w-12 mb-4" />
          <p className="font-medium">No tools registered</p>
          <p className="text-sm mt-1">
            Add a tool to make it available to agents.
          </p>
        </div>
      ) : (
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
            {tools.map((tool) => (
              <TableRow key={tool.id}>
                <TableCell className="font-mono text-sm">{tool.id}</TableCell>
                <TableCell className="font-medium">{tool.name}</TableCell>
                <TableCell>
                  <Badge variant={categoryVariant(tool.category)}>
                    {tool.category ?? 'unknown'}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-muted">
                  {tool.description ?? '-'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
