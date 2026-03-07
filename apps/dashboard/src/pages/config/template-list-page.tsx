import { useQuery } from '@tanstack/react-query';
import { Loader2, Copy, Download, Pencil, Plus, LayoutTemplate } from 'lucide-react';
import { dashboardApi, type DashboardTemplate } from '../../lib/api.js';
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

export function TemplateListPage(): JSX.Element {
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
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
