import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight as ChevronRightIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  Loader2,
  Plus,
  LayoutTemplate,
  Search,
  Pencil,
  Copy,
  Download,
  Trash2,
  Play,
  MoreVertical,
  Zap,
  Settings,
  Layers,
} from 'lucide-react';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu.js';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip.js';
import { Skeleton } from '../../components/ui/skeleton.js';
import { listTemplates, deleteTemplate, cloneTemplate } from './template-editor-api.js';
import type { TemplateResponse, TemplateSchema } from './template-editor-types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type FilterTab = 'all' | 'published' | 'drafts' | 'built-in';
type SortMode = 'recent' | 'name' | 'tasks';

function getTaskCount(schema: TemplateSchema | undefined): number {
  return schema?.tasks?.length ?? 0;
}

function getPhaseCount(schema: TemplateSchema | undefined): number {
  return schema?.workflow?.phases?.length ?? 0;
}

function getRoles(schema: TemplateSchema | undefined): string[] {
  if (!schema?.tasks) return [];
  const roles = new Set<string>();
  for (const task of schema.tasks) {
    if (task.role) roles.add(task.role);
  }
  return [...roles];
}

function hasWarmMode(schema: TemplateSchema | undefined): boolean {
  return schema?.runtime?.pool_mode === 'warm';
}

const ROLE_COLORS: Record<string, string> = {
  architect: 'bg-purple-500',
  developer: 'bg-blue-500',
  reviewer: 'bg-amber-500',
  qa: 'bg-green-500',
  orchestrator: 'bg-red-500',
};

function roleColor(role: string): string {
  return ROLE_COLORS[role] ?? 'bg-gray-400';
}

function exportTemplateJson(template: TemplateResponse) {
  const blob = new Blob([JSON.stringify(template.schema, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${template.slug}-v${template.version}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Delete dialog
// ---------------------------------------------------------------------------

function DeleteDialog({
  template,
  onClose,
}: {
  template: TemplateResponse;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => deleteTemplate(template.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      onClose();
      toast.success('Template deleted');
    },
    onError: () => toast.error('Failed to delete template'),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Template</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted">
          Are you sure you want to delete &quot;{template.name}&quot;? This
          action cannot be undone.
        </p>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Delete
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Template card
// ---------------------------------------------------------------------------

function TemplateCard({ template }: { template: TemplateResponse }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showDelete, setShowDelete] = useState(false);

  const cloneMutation = useMutation({
    mutationFn: () => cloneTemplate(template.id),
    onSuccess: (cloned) => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      toast.success('Template cloned');
      navigate(`/config/templates/${cloned.id}/edit`);
    },
    onError: () => toast.error('Failed to clone template'),
  });

  const schema = template.schema as TemplateSchema | undefined;
  const taskCount = getTaskCount(schema);
  const phaseCount = getPhaseCount(schema);
  const roles = getRoles(schema);
  const warm = hasWarmMode(schema);

  return (
    <>
      <div className="group rounded-lg border border-border bg-surface p-5 flex flex-col gap-3 hover:border-accent/40 transition-colors">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <button
            className="text-left flex-1 min-w-0"
            onClick={() => navigate(`/config/templates/${template.id}/edit`)}
          >
            <h3 className="font-semibold text-foreground truncate">{template.name}</h3>
          </button>
          <div className="flex items-center gap-1.5 shrink-0">
            <Badge variant="outline" className="text-[10px]">v{template.version}</Badge>
            <Badge variant={template.is_published ? 'success' : 'secondary'}>
              {template.is_published ? 'Published' : 'Draft'}
            </Badge>
            {warm && template.is_published && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <span className="inline-block h-2.5 w-2.5 rounded-full bg-green-500" />
                  </TooltipTrigger>
                  <TooltipContent>Warm containers active</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {warm && !template.is_published && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger><Settings className="h-3.5 w-3.5 text-muted" /></TooltipTrigger>
                  <TooltipContent>Warm mode configured but template is draft</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        </div>

        {/* Description */}
        <p className="text-sm text-muted line-clamp-2 min-h-[2.5rem]">
          {template.description || 'No description'}
        </p>

        {/* Stats */}
        <div className="flex items-center gap-4 text-xs text-muted">
          <span>{phaseCount} phase{phaseCount !== 1 ? 's' : ''}</span>
          <span>{taskCount} task{taskCount !== 1 ? 's' : ''}</span>
          {template.is_built_in && (
            <Badge variant="outline" className="text-[10px] py-0">Built-in</Badge>
          )}
        </div>

        {/* Roles */}
        {roles.length > 0 && (
          <TooltipProvider>
            <div className="flex items-center gap-1">
              {roles.map((role) => (
                <Tooltip key={role}>
                  <TooltipTrigger>
                    <span className={`inline-block h-2.5 w-2.5 rounded-full ${roleColor(role)}`} />
                  </TooltipTrigger>
                  <TooltipContent>{role}</TooltipContent>
                </Tooltip>
              ))}
              <span className="text-xs text-muted ml-1">{roles.length} role{roles.length !== 1 ? 's' : ''}</span>
            </div>
          </TooltipProvider>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 mt-auto pt-2 border-t border-border/50">
          {/* Desktop inline actions */}
          <div className="hidden sm:flex items-center gap-2 flex-1">
            {template.is_published && (
              <Button
                size="sm"
                onClick={() => navigate(`/config/templates/${template.id}/launch`)}
              >
                <Play className="h-3.5 w-3.5" />
                Launch
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate(`/config/templates/${template.id}/edit`)}
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
            {!template.is_published && !template.is_built_in && (
              <Badge variant="outline" className="text-[10px] ml-auto cursor-default">
                <Zap className="h-3 w-3 mr-0.5" />
                Draft
              </Badge>
            )}
          </div>

          {/* Overflow menu (always visible on mobile, hover on desktop) */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 sm:ml-auto"
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {/* Mobile-only actions */}
              <DropdownMenuItem
                className="sm:hidden"
                onClick={() => navigate(`/config/templates/${template.id}/edit`)}
              >
                <Pencil className="h-4 w-4 mr-2" />
                Edit
              </DropdownMenuItem>
              {template.is_published && (
                <DropdownMenuItem
                  className="sm:hidden"
                  onClick={() => navigate(`/config/templates/${template.id}/launch`)}
                >
                  <Play className="h-4 w-4 mr-2" />
                  Launch
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={() => cloneMutation.mutate()}
                disabled={cloneMutation.isPending}
              >
                <Copy className="h-4 w-4 mr-2" />
                {cloneMutation.isPending ? 'Cloning...' : 'Clone'}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportTemplateJson(template)}>
                <Download className="h-4 w-4 mr-2" />
                Export JSON
              </DropdownMenuItem>
              {!template.is_built_in && (
                <DropdownMenuItem
                  className="text-red-600"
                  onClick={() => setShowDelete(true)}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {showDelete && (
        <DeleteDialog template={template} onClose={() => setShowDelete(false)} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function TemplateListPage(): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterTab>('all');
  const [sort, setSort] = useState<SortMode>('recent');
  const [latestOnly, setLatestOnly] = useState(true);
  const [page, setPage] = useState(1);
  const PER_PAGE = 12;

  const { data, isLoading, error } = useQuery({
    queryKey: ['templates', page, latestOnly],
    queryFn: () => listTemplates({ page, per_page: PER_PAGE, latest_only: latestOnly }),
  });

  const handleCreateNew = () => navigate('/config/templates/new/edit');

  const templates = useMemo(() => {
    let list: TemplateResponse[] = data?.data ?? [];

    // Filter
    if (filter === 'published') list = list.filter((t) => t.is_published);
    else if (filter === 'drafts') list = list.filter((t) => !t.is_published);
    else if (filter === 'built-in') list = list.filter((t) => t.is_built_in);

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.slug.toLowerCase().includes(q) ||
          (t.description ?? '').toLowerCase().includes(q),
      );
    }

    // Sort
    if (sort === 'name') {
      list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    } else if (sort === 'tasks') {
      list = [...list].sort((a, b) => getTaskCount(b.schema) - getTaskCount(a.schema));
    }
    // 'recent' = default API order (created_at DESC)

    return list;
  }, [data, filter, search, sort]);

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 space-y-5">
        <div>
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-72 mt-2" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="rounded-lg border border-border p-5 space-y-3">
              <div className="flex items-center justify-between">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-5 w-16" />
              </div>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
              <div className="flex gap-4">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
          ))}
        </div>
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

  const FILTER_TABS: { key: FilterTab; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'published', label: 'Published' },
    { key: 'drafts', label: 'Drafts' },
    { key: 'built-in', label: 'Built-in' },
  ];

  const SORT_OPTIONS: { key: SortMode; label: string }[] = [
    { key: 'recent', label: 'Recent' },
    { key: 'name', label: 'Name A-Z' },
    { key: 'tasks', label: 'Most tasks' },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold">Templates</h1>
        <p className="text-sm text-muted mt-1">
          Reusable workflow blueprints. Create a template, then launch workflows
          from it.
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Search */}
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
          <Input
            placeholder="Search templates..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-1 overflow-x-auto">
          {FILTER_TABS.map((tab) => (
            <Button
              key={tab.key}
              size="sm"
              variant={filter === tab.key ? 'default' : 'ghost'}
              onClick={() => setFilter(tab.key)}
            >
              {tab.label}
            </Button>
          ))}
        </div>

        {/* Sort + Version toggle + Create */}
        <div className="flex items-center gap-2 sm:ml-auto">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant={latestOnly ? 'default' : 'outline'}
                  onClick={() => { setLatestOnly((v) => !v); setPage(1); }}
                >
                  <Layers className="h-4 w-4" />
                  Latest
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {latestOnly ? 'Showing latest version only — click to show all versions' : 'Showing all versions — click to show latest only'}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">
                Sort: {SORT_OPTIONS.find((o) => o.key === sort)?.label}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {SORT_OPTIONS.map((opt) => (
                <DropdownMenuItem key={opt.key} onClick={() => setSort(opt.key)}>
                  {opt.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            onClick={() => handleCreateNew()}
          >
            <Plus className="h-4 w-4" />
            New Template
          </Button>
        </div>
      </div>

      {/* Grid */}
      {templates.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted">
          <LayoutTemplate className="h-12 w-12 mb-4" />
          <p className="font-medium">
            {search || filter !== 'all' ? 'No matching templates' : 'No templates yet'}
          </p>
          <p className="text-sm mt-1">
            {search || filter !== 'all'
              ? 'Try adjusting your search or filters.'
              : latestOnly ? 'No templates found. Try showing all versions.' : 'Create your first template to get started.'}
          </p>
          {!search && filter === 'all' && (
            <Button className="mt-4" onClick={() => handleCreateNew()}>
              <Plus className="h-4 w-4" />
              Create your first template
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {templates.map((t) => (
              <TemplateCard key={t.id} template={t} />
            ))}
          </div>
          {/* Pagination */}
          <div className="flex items-center justify-between pt-2">
            <p className="text-xs text-muted">
              Showing {templates.length} of {data?.meta?.total ?? templates.length} templates
            </p>
            {(data?.meta?.pages ?? 1) > 1 && (
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="h-7 w-7 p-0"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-xs text-muted px-2">
                  {page} / {data?.meta?.pages ?? 1}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= (data?.meta?.pages ?? 1)}
                  onClick={() => setPage((p) => p + 1)}
                  className="h-7 w-7 p-0"
                >
                  <ChevronRightIcon className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
