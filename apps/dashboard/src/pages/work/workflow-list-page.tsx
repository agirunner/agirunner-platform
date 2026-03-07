import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Search, Loader2 } from 'lucide-react';
import { dashboardApi } from '../../lib/api.js';
import { cn } from '../../lib/utils.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
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

interface Workflow {
  id: string;
  name: string;
  project_name?: string;
  status: string;
  state?: string;
  current_phase?: string;
  task_counts?: Record<string, number>;
  cost?: number;
  created_at: string;
}

interface Template {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
}

type StatusFilter = 'all' | 'running' | 'completed' | 'failed' | 'paused';

const STATUS_FILTERS: StatusFilter[] = ['all', 'running', 'completed', 'failed', 'paused'];

function normalizeWorkflows(response: unknown): Workflow[] {
  if (Array.isArray(response)) {
    return response as Workflow[];
  }
  const wrapped = response as { data?: unknown };
  return Array.isArray(wrapped?.data) ? (wrapped.data as Workflow[]) : [];
}

function normalizeTemplates(response: { data: Template[] }): Template[] {
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
  if (!counts) {
    return '-';
  }
  const completed = counts.completed ?? 0;
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  return `${completed}/${total}`;
}

function formatCost(cost?: number): string {
  if (cost === undefined || cost === null) {
    return '-';
  }
  return `$${cost.toFixed(2)}`;
}

function WorkflowTable({
  workflows,
}: {
  workflows: Workflow[];
}): JSX.Element {
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

function LaunchDialog({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [workflowName, setWorkflowName] = useState('');

  const templatesQuery = useQuery({
    queryKey: ['templates'],
    queryFn: () => dashboardApi.listTemplates(),
    enabled: isOpen,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      dashboardApi.createWorkflow({
        template_id: selectedTemplateId,
        name: workflowName,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
      setSelectedTemplateId('');
      setWorkflowName('');
      onOpenChange(false);
    },
  });

  const templates = templatesQuery.data ? normalizeTemplates(templatesQuery.data) : [];
  const isSubmitDisabled = !selectedTemplateId || !workflowName.trim() || createMutation.isPending;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Launch Workflow</DialogTitle>
          <DialogDescription>Select a template and provide a name.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Template</label>
            <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a template" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Workflow Name</label>
            <Input
              placeholder="Enter workflow name"
              value={workflowName}
              onChange={(e) => setWorkflowName(e.target.value)}
            />
          </div>

          {createMutation.isError && (
            <p className="text-sm text-red-600">
              Failed to create workflow. Please try again.
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              disabled={isSubmitDisabled}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Launch
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function WorkflowListPage(): JSX.Element {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLaunchOpen, setIsLaunchOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['workflows'],
    queryFn: () => dashboardApi.listWorkflows(),
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
      <div className="p-6 text-red-600">Failed to load workflows. Please try again later.</div>
    );
  }

  const allWorkflows = normalizeWorkflows(data);
  const normalizedSearch = searchQuery.trim().toLowerCase();

  const filteredWorkflows = allWorkflows.filter((wf) => {
    const status = resolveStatus(wf);
    if (statusFilter !== 'all' && status !== statusFilter) {
      return false;
    }
    if (normalizedSearch && !wf.name.toLowerCase().includes(normalizedSearch)) {
      return false;
    }
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
      </div>

      <WorkflowTable workflows={filteredWorkflows} />

      <LaunchDialog isOpen={isLaunchOpen} onOpenChange={setIsLaunchOpen} />
    </div>
  );
}
