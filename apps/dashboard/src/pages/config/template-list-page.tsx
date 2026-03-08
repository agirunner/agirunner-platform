import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Copy, Download, Pencil, Plus, LayoutTemplate, GitCompare, Trash2 } from 'lucide-react';
import { dashboardApi, type DashboardTemplate } from '../../lib/api.js';
import { readSession } from '../../lib/session.js';
import { toast } from '../../lib/toast.js';
import { Button } from '../../components/ui/button.js';
import { Badge } from '../../components/ui/badge.js';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../../components/ui/table.js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../components/ui/dialog.js';
import { DiffViewer } from '../../components/diff-viewer.js';

function normalizeTemplates(
  response: { data: DashboardTemplate[] } | DashboardTemplate[] | undefined,
): DashboardTemplate[] {
  if (!response) return [];
  if (Array.isArray(response)) return response;
  return response?.data ?? [];
}

function exportTemplate(template: DashboardTemplate) {
  const blob = new Blob([JSON.stringify(template, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${template.slug}-v${template.version}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

const API_BASE_URL =
  import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';

async function deleteTemplate(id: string): Promise<void> {
  const session = readSession();
  const headers: Record<string, string> = {};
  if (session?.accessToken) {
    headers.Authorization = `Bearer ${session.accessToken}`;
  }
  const response = await fetch(`${API_BASE_URL}/api/v1/templates/${id}`, {
    method: 'DELETE',
    headers,
    credentials: 'include',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

function DeleteTemplateDialog({
  template,
  onClose,
}: {
  template: DashboardTemplate;
  onClose: () => void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => deleteTemplate(template.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      onClose();
      toast.success('Template deleted');
    },
    onError: () => {
      toast.error('Failed to delete template');
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Template</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted">
          Are you sure you want to delete &quot;{template.name}&quot;? This action cannot be undone.
        </p>
        {mutation.error && (
          <p className="text-sm text-red-600">{String(mutation.error)}</p>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            data-testid="confirm-delete"
          >
            {mutation.isPending && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            Delete
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function buildDiffText(template: DashboardTemplate, version: number): string {
  const header = `Template: ${template.name}\nVersion: ${version}\n`;
  return header + JSON.stringify(template.schema, null, 2);
}

function TemplateActions({ template, onDiff }: { template: DashboardTemplate; onDiff: () => void }): JSX.Element {
  const [showDelete, setShowDelete] = useState(false);

  return (
    <>
      <div className="flex items-center gap-1">
        <Button
          size="icon"
          variant="ghost"
          title="Edit template"
          onClick={() => {
            window.location.assign(`/config/templates/${template.id}/edit`);
          }}
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          title="Clone template"
        >
          <Copy className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          title="Export as JSON"
          onClick={() => exportTemplate(template)}
        >
          <Download className="h-4 w-4" />
        </Button>
        {template.version > 1 && (
          <Button
            size="icon"
            variant="ghost"
            title="View diff with previous version"
            onClick={onDiff}
          >
            <GitCompare className="h-4 w-4" />
          </Button>
        )}
        {!template.is_built_in && (
          <Button
            size="icon"
            variant="ghost"
            title="Delete template"
            onClick={() => setShowDelete(true)}
            data-testid={`delete-template-${template.slug}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
      {showDelete && (
        <DeleteTemplateDialog
          template={template}
          onClose={() => setShowDelete(false)}
        />
      )}
    </>
  );
}

export function TemplateListPage(): JSX.Element {
  const [diffTemplate, setDiffTemplate] = useState<DashboardTemplate | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['templates'],
    queryFn: () => dashboardApi.listTemplates(),
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
          Failed to load templates: {String(error)}
        </div>
      </div>
    );
  }

  const templates = normalizeTemplates(data);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Templates</h1>
          <p className="text-sm text-muted">
            Manage workflow templates, versions, and publishing.
          </p>
        </div>
        <Button disabled title="Coming soon">
          <Plus className="h-4 w-4" />
          Create Template
        </Button>
      </div>

      {templates.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted">
          <LayoutTemplate className="h-12 w-12 mb-4" />
          <p className="font-medium">No templates found</p>
          <p className="text-sm mt-1">Templates will appear here once created.</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Built-in</TableHead>
              <TableHead className="w-[140px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.map((template) => (
              <TableRow key={template.id}>
                <TableCell className="font-medium">{template.name}</TableCell>
                <TableCell className="font-mono text-xs text-muted">
                  {template.slug}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">v{template.version}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={template.is_published ? 'success' : 'secondary'}>
                    {template.is_published ? 'Published' : 'Draft'}
                  </Badge>
                </TableCell>
                <TableCell>
                  {template.is_built_in ? (
                    <Badge variant="outline">Built-in</Badge>
                  ) : (
                    <span className="text-sm text-muted">Custom</span>
                  )}
                </TableCell>
                <TableCell>
                  <TemplateActions
                    template={template}
                    onDiff={() => setDiffTemplate(template)}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={diffTemplate !== null} onOpenChange={(open) => { if (!open) setDiffTemplate(null); }}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Template Version Diff</DialogTitle>
            <DialogDescription>
              Comparing version {(diffTemplate?.version ?? 1) - 1} with version {diffTemplate?.version ?? 1} of {diffTemplate?.name ?? ''}.
            </DialogDescription>
          </DialogHeader>
          {diffTemplate && (
            <DiffViewer
              oldText={buildDiffText(diffTemplate, diffTemplate.version - 1)}
              newText={buildDiffText(diffTemplate, diffTemplate.version)}
              oldLabel={`v${diffTemplate.version - 1}`}
              newLabel={`v${diffTemplate.version}`}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
