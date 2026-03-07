import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Plus,
  Search,
  Loader2,
  List,
  LayoutGrid,
  ChevronRight,
  ChevronLeft,
  Check,
  Settings2,
} from 'lucide-react';
import { dashboardApi } from '../../lib/api.js';
import type { DashboardTemplate, DashboardProjectRecord } from '../../lib/api.js';
import { toast } from '../../lib/toast.js';
import { cn } from '../../lib/utils.js';
import { Skeleton } from '../../components/ui/skeleton.js';
import { SavedViews, type SavedViewFilters } from '../../components/saved-views.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../../components/ui/table.js';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from '../../components/ui/select.js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../components/ui/dialog.js';
import { Separator } from '../../components/ui/separator.js';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Workflow {
  id: string;
  name: string;
  project_name?: string;
  project_id?: string;
  template_name?: string;
  status: string;
  state?: string;
  current_phase?: string;
  task_counts?: Record<string, number>;
  cost?: number;
  created_at: string;
}

type StatusFilter = 'all' | 'running' | 'completed' | 'failed' | 'paused' | 'pending';
type ViewMode = 'list' | 'board';

const STATUS_FILTERS: StatusFilter[] = ['all', 'running', 'completed', 'failed', 'paused', 'pending'];

const BOARD_COLUMNS = ['pending', 'running', 'paused', 'completed', 'failed'] as const;
type BoardColumn = (typeof BOARD_COLUMNS)[number];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function normalizeWorkflows(response: unknown): Workflow[] {
  if (Array.isArray(response)) return response as Workflow[];
  const wrapped = response as { data?: unknown };
  return Array.isArray(wrapped?.data) ? (wrapped.data as Workflow[]) : [];
}

function normalizeTemplates(response: { data: DashboardTemplate[] }): DashboardTemplate[] {
  return response?.data ?? [];
}

function normalizeProjects(
  response: { data: DashboardProjectRecord[] } | DashboardProjectRecord[],
): DashboardProjectRecord[] {
  if (Array.isArray(response)) return response;
  return response?.data ?? [];
}

function resolveStatus(workflow: Workflow): string {
  return (workflow.status ?? workflow.state ?? 'unknown').toLowerCase();
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

function formatTaskProgress(counts?: Record<string, number>): string {
  if (!counts) return '-';
  const completed = counts.completed ?? 0;
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  return `${completed}/${total}`;
}

function formatCost(cost?: number): string {
  if (cost === undefined || cost === null) return '-';
  return `$${cost.toFixed(2)}`;
}

/* ------------------------------------------------------------------ */
/*  List View                                                          */
/* ------------------------------------------------------------------ */

function WorkflowTable({ workflows }: { workflows: Workflow[] }): JSX.Element {
  if (workflows.length === 0) {
    return (
      <p className="py-8 text-center text-muted">No workflows match the current filters.</p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Project</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Phase</TableHead>
          <TableHead>Tasks</TableHead>
          <TableHead>Cost</TableHead>
          <TableHead>Created</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {workflows.map((wf) => {
          const status = resolveStatus(wf);
          return (
            <TableRow key={wf.id}>
              <TableCell className="font-medium">
                <Link
                  to={`/work/workflows/${wf.id}`}
                  className="text-accent hover:underline"
                >
                  {wf.name}
                </Link>
              </TableCell>
              <TableCell>{wf.project_name ?? '-'}</TableCell>
              <TableCell>
                <Badge variant={statusBadgeVariant(status)} className="capitalize">
                  {status}
                </Badge>
              </TableCell>
              <TableCell className="capitalize">{wf.current_phase ?? '-'}</TableCell>
              <TableCell>{formatTaskProgress(wf.task_counts)}</TableCell>
              <TableCell>{formatCost(wf.cost)}</TableCell>
              <TableCell className="text-muted">
                {new Date(wf.created_at).toLocaleDateString()}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/* ------------------------------------------------------------------ */
/*  Board View                                                         */
/* ------------------------------------------------------------------ */

function BoardColumnView({
  column,
  workflows,
}: {
  column: BoardColumn;
  workflows: Workflow[];
}): JSX.Element {
  return (
    <div className="flex-1 min-w-[200px]">
      <div className="mb-3 flex items-center gap-2">
        <Badge variant={statusBadgeVariant(column)} className="capitalize">
          {column}
        </Badge>
        <span className="text-xs text-muted">{workflows.length}</span>
      </div>
      <div className="space-y-2">
        {workflows.map((wf) => (
          <Link key={wf.id} to={`/work/workflows/${wf.id}`} className="block">
            <Card className="transition-shadow hover:shadow-md">
              <CardContent className="p-3">
                <p className="text-sm font-medium truncate">{wf.name}</p>
                <p className="text-xs text-muted mt-1 truncate">
                  {wf.project_name ?? 'No project'}
                </p>
                <div className="mt-2 flex items-center justify-between text-xs text-muted">
                  <span>{wf.template_name ?? '-'}</span>
                  <span>{formatTaskProgress(wf.task_counts)} tasks</span>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
        {workflows.length === 0 && (
          <p className="py-4 text-center text-xs text-muted">None</p>
        )}
      </div>
    </div>
  );
}

function WorkflowBoard({ workflows }: { workflows: Workflow[] }): JSX.Element {
  const grouped = useMemo(() => {
    const map = new Map<BoardColumn, Workflow[]>();
    for (const col of BOARD_COLUMNS) {
      map.set(col, []);
    }
    for (const wf of workflows) {
      const status = resolveStatus(wf) as BoardColumn;
      const bucket = BOARD_COLUMNS.includes(status) ? status : 'pending';
      map.get(bucket)!.push(wf);
    }
    return map;
  }, [workflows]);

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {BOARD_COLUMNS.map((col) => (
        <BoardColumnView key={col} column={col} workflows={grouped.get(col) ?? []} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Wizard Step Indicator                                              */
/* ------------------------------------------------------------------ */

const WIZARD_STEPS = ['Select Template', 'Configure', 'Review & Launch'] as const;

function StepIndicator({ currentStep }: { currentStep: number }): JSX.Element {
  return (
    <div className="flex items-center gap-2 mb-6">
      {WIZARD_STEPS.map((label, idx) => (
        <div key={label} className="flex items-center gap-2">
          {idx > 0 && (
            <div className={cn('h-0.5 w-8', idx <= currentStep ? 'bg-accent' : 'bg-border')} />
          )}
          <div className="flex items-center gap-1.5">
            <div
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium',
                idx < currentStep && 'bg-accent text-white',
                idx === currentStep && 'border-2 border-accent text-accent',
                idx > currentStep && 'border border-border text-muted',
              )}
            >
              {idx < currentStep ? <Check className="h-3 w-3" /> : idx + 1}
            </div>
            <span className={cn('text-xs', idx === currentStep ? 'font-medium' : 'text-muted')}>
              {label}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Launch Wizard Dialog                                               */
/* ------------------------------------------------------------------ */

function LaunchWizardDialog({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [selectedTemplate, setSelectedTemplate] = useState<DashboardTemplate | null>(null);
  const [workflowName, setWorkflowName] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [templateSearch, setTemplateSearch] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [configOverrides, setConfigOverrides] = useState('{}');
  const [parameters, setParameters] = useState<Record<string, string>>({});

  const templatesQuery = useQuery({
    queryKey: ['templates'],
    queryFn: () => dashboardApi.listTemplates(),
    enabled: isOpen,
  });

  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: () => dashboardApi.listProjects(),
    enabled: isOpen && step >= 1,
  });

  const createMutation = useMutation({
    mutationFn: () => {
      let mergedParams: Record<string, unknown> = {};
      Object.entries(parameters).forEach(([k, v]) => {
        if (v.trim()) {
          try {
            mergedParams[k] = JSON.parse(v);
          } catch {
            mergedParams[k] = v;
          }
        }
      });

      if (showAdvanced) {
        try {
          const overrides = JSON.parse(configOverrides);
          mergedParams = { ...mergedParams, ...overrides };
        } catch {
          /* ignore invalid JSON overrides */
        }
      }

      return dashboardApi.createWorkflow({
        template_id: selectedTemplate!.id,
        name: workflowName,
        parameters: Object.keys(mergedParams).length > 0 ? mergedParams : undefined,
        metadata: selectedProjectId ? { project_id: selectedProjectId } : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
      resetWizard();
      onOpenChange(false);
      toast.success('Workflow launched successfully');
    },
    onError: () => {
      toast.error('Failed to launch workflow');
    },
  });

  function resetWizard() {
    setStep(0);
    setSelectedTemplate(null);
    setWorkflowName('');
    setSelectedProjectId('');
    setTemplateSearch('');
    setShowAdvanced(false);
    setConfigOverrides('{}');
    setParameters({});
  }

  function handleOpenChange(open: boolean) {
    if (!open) resetWizard();
    onOpenChange(open);
  }

  const templates = templatesQuery.data ? normalizeTemplates(templatesQuery.data) : [];
  const projects = projectsQuery.data ? normalizeProjects(projectsQuery.data) : [];

  const filteredTemplates = templateSearch.trim()
    ? templates.filter(
        (t) =>
          t.name.toLowerCase().includes(templateSearch.toLowerCase()) ||
          (t.description ?? '').toLowerCase().includes(templateSearch.toLowerCase()),
      )
    : templates;

  const templateVariables = useMemo(() => {
    if (!selectedTemplate?.schema) return [];
    const props = (
      selectedTemplate.schema as {
        properties?: Record<string, { type?: string; description?: string }>;
      }
    ).properties;
    if (!props) return [];
    return Object.entries(props).map(([key, schema]) => ({
      key,
      type: schema.type ?? 'string',
      description: schema.description ?? '',
    }));
  }, [selectedTemplate]);

  const isStep1Valid = Boolean(selectedTemplate);
  const isStep2Valid = Boolean(workflowName.trim());

  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Launch Workflow</DialogTitle>
          <DialogDescription>
            {step === 0 && 'Select a workflow template to get started.'}
            {step === 1 && 'Configure your workflow parameters.'}
            {step === 2 && 'Review your configuration and launch.'}
          </DialogDescription>
        </DialogHeader>

        <StepIndicator currentStep={step} />

        {/* Step 1: Select Template */}
        {step === 0 && (
          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted" />
              <Input
                placeholder="Search templates..."
                className="pl-9"
                value={templateSearch}
                onChange={(e) => setTemplateSearch(e.target.value)}
              />
            </div>

            <div className="max-h-64 overflow-y-auto space-y-2">
              {templatesQuery.isLoading && (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted" />
                </div>
              )}
              {filteredTemplates.map((t) => (
                <div
                  key={t.id}
                  className={cn(
                    'cursor-pointer rounded-md border p-3 transition-colors',
                    selectedTemplate?.id === t.id
                      ? 'border-accent bg-accent/5'
                      : 'border-border hover:border-accent/50',
                  )}
                  onClick={() => setSelectedTemplate(t)}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{t.name}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-[10px]">
                        v{t.version}
                      </Badge>
                      <Badge
                        variant={t.is_built_in ? 'default' : 'outline'}
                        className="text-[10px]"
                      >
                        {t.is_built_in ? 'Built-in' : 'Custom'}
                      </Badge>
                    </div>
                  </div>
                  {t.description && (
                    <p className="mt-1 text-xs text-muted line-clamp-2">{t.description}</p>
                  )}
                </div>
              ))}
              {!templatesQuery.isLoading && filteredTemplates.length === 0 && (
                <p className="py-4 text-center text-sm text-muted">No templates found.</p>
              )}
            </div>

            <div className="flex justify-end">
              <Button disabled={!isStep1Valid} onClick={() => setStep(1)}>
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Configure Parameters */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Workflow Name <span className="text-red-500">*</span>
              </label>
              <Input
                placeholder="Enter workflow name"
                value={workflowName}
                onChange={(e) => setWorkflowName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Project</label>
              <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a project (optional)" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {templateVariables.length > 0 && (
              <>
                <Separator />
                <p className="text-sm font-medium">Template Variables</p>
                {templateVariables.map((v) => (
                  <div key={v.key} className="space-y-1">
                    <label className="text-xs font-medium">
                      {v.key}
                      {v.description && (
                        <span className="ml-1 font-normal text-muted">({v.description})</span>
                      )}
                    </label>
                    <Input
                      placeholder={`Type: ${v.type}`}
                      value={parameters[v.key] ?? ''}
                      onChange={(e) =>
                        setParameters((prev) => ({ ...prev, [v.key]: e.target.value }))
                      }
                    />
                  </div>
                ))}
              </>
            )}

            <button
              type="button"
              className="flex items-center gap-1 text-xs text-accent hover:underline"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              <Settings2 className="h-3 w-3" />
              {showAdvanced ? 'Hide Advanced' : 'Show Advanced'}
            </button>

            {showAdvanced && (
              <div className="space-y-1">
                <label className="text-xs font-medium">Config Overrides (JSON)</label>
                <textarea
                  className="flex min-h-[80px] w-full rounded-md border border-border bg-transparent px-3 py-2 text-xs font-mono shadow-sm placeholder:text-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                  value={configOverrides}
                  onChange={(e) => setConfigOverrides(e.target.value)}
                />
              </div>
            )}

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(0)}>
                <ChevronLeft className="h-4 w-4" />
                Back
              </Button>
              <Button disabled={!isStep2Valid} onClick={() => setStep(2)}>
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Review & Launch */}
        {step === 2 && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <SummaryRow label="Name" value={workflowName} />
                <SummaryRow label="Template" value={selectedTemplate?.name ?? '-'} />
                <SummaryRow
                  label="Version"
                  value={selectedTemplate ? `v${selectedTemplate.version}` : '-'}
                />
                <SummaryRow label="Project" value={selectedProject?.name ?? 'None'} />
                {templateVariables.length > 0 && (
                  <SummaryRow
                    label="Parameters"
                    value={`${templateVariables.filter((v) => parameters[v.key]?.trim()).length} configured`}
                  />
                )}
              </CardContent>
            </Card>

            {selectedTemplate?.schema && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Template Phases</CardTitle>
                </CardHeader>
                <CardContent>
                  <TemplatePhasePreview schema={selectedTemplate.schema} />
                </CardContent>
              </Card>
            )}

            {createMutation.isError && (
              <p className="text-sm text-red-600">
                Failed to create workflow. Please try again.
              </p>
            )}

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>
                <ChevronLeft className="h-4 w-4" />
                Back
              </Button>
              <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
                {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Launch
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex justify-between">
      <span className="text-muted">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function TemplatePhasePreview({ schema }: { schema: Record<string, unknown> }): JSX.Element {
  const phases = (schema as { phases?: Array<{ name?: string; tasks?: unknown[] }> }).phases;
  if (!Array.isArray(phases) || phases.length === 0) {
    return <p className="text-xs text-muted">No phase information available in schema.</p>;
  }

  return (
    <div className="space-y-1">
      {phases.map((phase, idx) => {
        const taskCount = Array.isArray(phase.tasks) ? phase.tasks.length : 0;
        return (
          <div key={phase.name ?? idx} className="flex items-center gap-2">
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-border text-[10px] font-medium">
              {idx + 1}
            </div>
            <span className="text-xs capitalize">{phase.name ?? `Phase ${idx + 1}`}</span>
            {taskCount > 0 && (
              <span className="text-[10px] text-muted">
                ({taskCount} task{taskCount > 1 ? 's' : ''})
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page                                                          */
/* ------------------------------------------------------------------ */

export function WorkflowListPage(): JSX.Element {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLaunchOpen, setIsLaunchOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  const { data, isLoading, error } = useQuery({
    queryKey: ['workflows'],
    queryFn: () => dashboardApi.listWorkflows(),
  });

  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-9 w-36" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-9 w-64" />
        </div>
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-red-600">Failed to load workflows. Please try again later.</div>
    );
  }

  const allWorkflows = normalizeWorkflows(data);
  const normalizedSearch = searchQuery.trim().toLowerCase();

  const filteredWorkflows = allWorkflows.filter((wf) => {
    const status = resolveStatus(wf);
    if (statusFilter !== 'all' && status !== statusFilter) return false;
    if (normalizedSearch && !wf.name.toLowerCase().includes(normalizedSearch)) return false;
    return true;
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Workflows</h1>
        <Button onClick={() => setIsLaunchOpen(true)}>
          <Plus className="h-4 w-4" />
          Launch Workflow
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={statusFilter}
          onValueChange={(value) => setStatusFilter(value as StatusFilter)}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((s) => (
              <SelectItem key={s} value={s}>
                {s === 'all' ? 'All Statuses' : s.charAt(0).toUpperCase() + s.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted" />
          <Input
            placeholder="Search workflows..."
            className="pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <SavedViews
          storageKey="workflow-list"
          currentFilters={{ status: statusFilter, search: searchQuery }}
          onApply={(filters: SavedViewFilters) => {
            setStatusFilter((filters.status as StatusFilter) ?? 'all');
            setSearchQuery(filters.search ?? '');
          }}
        />

        <div className="ml-auto flex items-center gap-1 rounded-md border border-border p-0.5">
          <Button
            variant={viewMode === 'list' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('list')}
            aria-label="List view"
          >
            <List className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === 'board' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('board')}
            aria-label="Board view"
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {viewMode === 'list' ? (
        <WorkflowTable workflows={filteredWorkflows} />
      ) : (
        <WorkflowBoard workflows={filteredWorkflows} />
      )}

      <LaunchWizardDialog isOpen={isLaunchOpen} onOpenChange={setIsLaunchOpen} />
    </div>
  );
}
