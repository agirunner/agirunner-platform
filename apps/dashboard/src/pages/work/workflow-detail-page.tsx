import { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Loader2,
  Pause,
  Play,
  XCircle,
  Clock,
  DollarSign,
  FolderOpen,
  FileText,
  X,
  ChevronRight,
  Plus,
  Trash2,
  Save,
  Link2,
} from 'lucide-react';
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeProps,
  Handle,
  Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { dashboardApi } from '../../lib/api.js';
import type {
  DashboardResolvedConfigResponse,
  DashboardResolvedDocumentReference,
  DashboardEventRecord,
} from '../../lib/api.js';
import { cn } from '../../lib/utils.js';
import { LogViewer } from '../../components/log-viewer/log-viewer.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
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
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '../../components/ui/tabs.js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../components/ui/dialog.js';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from '../../components/ui/select.js';
import { Textarea } from '../../components/ui/textarea.js';
import { ChainWorkflowDialog } from '../../components/chain-workflow-dialog.js';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface WorkflowTask {
  id: string;
  name?: string;
  title?: string;
  status: string;
  state?: string;
  role?: string;
  phase?: string;
  agent_id?: string;
  agent_name?: string;
  duration_seconds?: number;
  started_at?: string;
  completed_at?: string;
  output?: unknown;
}

interface WorkflowPhase {
  name: string;
  status: string;
  state?: string;
  gate_type?: string;
}

interface Workflow {
  id: string;
  name: string;
  status: string;
  state?: string;
  project_id?: string;
  project_name?: string;
  template_id?: string;
  template_name?: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  duration_seconds?: number;
  cost?: number;
  current_phase?: string;
  phases?: WorkflowPhase[];
  tasks?: WorkflowTask[];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function normalizeWorkflow(response: unknown): Workflow {
  const wrapped = response as { data?: unknown };
  if (wrapped?.data && typeof wrapped.data === 'object' && 'id' in (wrapped.data as object)) {
    return wrapped.data as Workflow;
  }
  return response as Workflow;
}

function resolveStatus(entity: { status?: string; state?: string }): string {
  return (entity.status ?? entity.state ?? 'unknown').toLowerCase();
}

function statusBadgeVariant(status: string) {
  const map: Record<string, 'success' | 'default' | 'destructive' | 'warning' | 'secondary'> = {
    completed: 'success',
    running: 'default',
    failed: 'destructive',
    paused: 'warning',
    pending: 'secondary',
    awaiting_approval: 'warning',
  };
  return map[status] ?? 'secondary';
}

function formatDuration(seconds?: number): string {
  if (seconds === undefined || seconds === null) {
    return '-';
  }
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60);
  return `${minutes}m ${remaining}s`;
}

function computeDuration(workflow: Workflow): string {
  if (workflow.duration_seconds !== undefined && workflow.duration_seconds !== null) {
    return formatDuration(workflow.duration_seconds);
  }
  if (!workflow.started_at) {
    return '-';
  }
  const start = new Date(workflow.started_at).getTime();
  const end = workflow.completed_at ? new Date(workflow.completed_at).getTime() : Date.now();
  return formatDuration((end - start) / 1000);
}

const TASK_STATE_COLORS: Record<string, string> = {
  completed: 'border-green-400 bg-green-50 text-green-800',
  running: 'border-blue-400 bg-blue-50 text-blue-800',
  pending: 'border-gray-300 bg-gray-50 text-gray-600',
  failed: 'border-red-400 bg-red-50 text-red-800',
  awaiting_approval: 'border-yellow-400 bg-yellow-50 text-yellow-800',
};

const GATE_LABELS: Record<string, string> = {
  auto: 'Auto',
  manual: 'Manual',
  all_complete: 'All Complete',
};

const NODE_WIDTH = 180;
const NODE_HEIGHT = 48;
const LANE_PADDING_X = 40;
const LANE_PADDING_Y = 60;
const NODE_GAP_X = 40;
const NODE_GAP_Y = 16;
const LANE_HEADER_WIDTH = 140;

/* ------------------------------------------------------------------ */
/*  ReactFlow custom node                                              */
/* ------------------------------------------------------------------ */

function TaskNode({ data }: NodeProps): JSX.Element {
  const status = String(data.status ?? 'pending');
  const colorClasses = TASK_STATE_COLORS[status] ?? TASK_STATE_COLORS.pending;

  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-md border-2 px-3 py-2 text-xs font-medium shadow-sm cursor-pointer',
        colorClasses,
      )}
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
      onClick={() => {
        if (typeof data.onClick === 'function') {
          (data.onClick as () => void)();
        }
      }}
    >
      <Handle type="target" position={Position.Left} className="opacity-0" />
      <span className="truncate">{String(data.label)}</span>
      <Handle type="source" position={Position.Right} className="opacity-0" />
    </div>
  );
}

function GateNode({ data }: NodeProps): JSX.Element {
  const gateLabel = GATE_LABELS[String(data.gateType)] ?? String(data.gateType ?? 'gate');

  return (
    <div className="flex items-center justify-center rounded-full border-2 border-amber-400 bg-amber-50 px-3 py-1 text-[10px] font-semibold text-amber-700 shadow-sm">
      <Handle type="target" position={Position.Left} className="opacity-0" />
      {gateLabel}
      <Handle type="source" position={Position.Right} className="opacity-0" />
    </div>
  );
}

const nodeTypes = {
  taskNode: TaskNode,
  gateNode: GateNode,
};

/* ------------------------------------------------------------------ */
/*  Build swimlane graph                                               */
/* ------------------------------------------------------------------ */

function buildSwimlaneGraph(
  phases: WorkflowPhase[],
  tasks: WorkflowTask[],
  onTaskClick: (taskId: string) => void,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  if (phases.length === 0) {
    return { nodes, edges };
  }

  const tasksByPhase = new Map<string, WorkflowTask[]>();
  for (const phase of phases) {
    tasksByPhase.set(phase.name, []);
  }
  for (const task of tasks) {
    const phaseName = task.phase ?? phases[0]?.name ?? 'default';
    const list = tasksByPhase.get(phaseName) ?? [];
    list.push(task);
    tasksByPhase.set(phaseName, list);
  }

  let currentY = 0;

  phases.forEach((phase, phaseIdx) => {
    const phaseTasks = tasksByPhase.get(phase.name) ?? [];
    const rowCount = Math.max(phaseTasks.length, 1);
    const laneHeight = LANE_PADDING_Y * 2 + rowCount * NODE_HEIGHT + (rowCount - 1) * NODE_GAP_Y;

    nodes.push({
      id: `lane-${phase.name}`,
      type: 'group',
      position: { x: 0, y: currentY },
      data: { label: phase.name },
      style: {
        width: LANE_HEADER_WIDTH + LANE_PADDING_X * 2 + NODE_WIDTH + 60,
        height: laneHeight,
        backgroundColor: phaseIdx % 2 === 0 ? 'rgba(243,244,246,0.5)' : 'rgba(249,250,251,0.5)',
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
      },
    });

    nodes.push({
      id: `lane-label-${phase.name}`,
      type: 'default',
      position: { x: 8, y: laneHeight / 2 - 14 },
      parentId: `lane-${phase.name}`,
      data: { label: phase.name },
      draggable: false,
      selectable: false,
      style: {
        fontSize: '12px',
        fontWeight: 600,
        textTransform: 'capitalize' as const,
        background: 'transparent',
        border: 'none',
        width: LANE_HEADER_WIDTH - 16,
        padding: 0,
      },
    });

    phaseTasks.forEach((task, taskIdx) => {
      const taskX = LANE_HEADER_WIDTH + LANE_PADDING_X;
      const taskY = LANE_PADDING_Y + taskIdx * (NODE_HEIGHT + NODE_GAP_Y);

      nodes.push({
        id: `task-${task.id}`,
        type: 'taskNode',
        position: { x: taskX, y: taskY },
        parentId: `lane-${phase.name}`,
        data: {
          label: task.title ?? task.name ?? task.id,
          status: resolveStatus(task),
          onClick: () => onTaskClick(task.id),
        },
      });
    });

    if (phaseIdx < phases.length - 1) {
      const gateType = phase.gate_type ?? 'auto';
      const gateId = `gate-${phase.name}`;
      const gateY = currentY + laneHeight + 8;

      nodes.push({
        id: gateId,
        type: 'gateNode',
        position: { x: LANE_HEADER_WIDTH + LANE_PADDING_X + NODE_WIDTH / 2 - 30, y: gateY },
        data: { gateType },
      });

      const lastTaskInPhase = phaseTasks[phaseTasks.length - 1];
      if (lastTaskInPhase) {
        edges.push({
          id: `e-${lastTaskInPhase.id}-${gateId}`,
          source: `task-${lastTaskInPhase.id}`,
          target: gateId,
          type: 'smoothstep',
        });
      }

      const nextPhase = phases[phaseIdx + 1];
      const nextPhaseTasks = tasksByPhase.get(nextPhase.name) ?? [];
      if (nextPhaseTasks.length > 0) {
        edges.push({
          id: `e-${gateId}-${nextPhaseTasks[0].id}`,
          source: gateId,
          target: `task-${nextPhaseTasks[0].id}`,
          type: 'smoothstep',
        });
      }

      currentY = gateY + 36;
    } else {
      currentY += laneHeight + 16;
    }
  });

  return { nodes, edges };
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function ActionButtons({ workflow }: { workflow: Workflow }): JSX.Element {
  const queryClient = useQueryClient();
  const status = resolveStatus(workflow);

  const pauseMutation = useMutation({
    mutationFn: () => dashboardApi.pauseWorkflow(workflow.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workflow', workflow.id] }),
  });

  const resumeMutation = useMutation({
    mutationFn: () => dashboardApi.resumeWorkflow(workflow.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workflow', workflow.id] }),
  });

  const cancelMutation = useMutation({
    mutationFn: () => dashboardApi.cancelWorkflow(workflow.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workflow', workflow.id] }),
  });

  const isActionPending =
    pauseMutation.isPending || resumeMutation.isPending || cancelMutation.isPending;

  return (
    <div className="flex gap-2">
      {status === 'running' && (
        <Button
          variant="outline"
          size="sm"
          disabled={isActionPending}
          onClick={() => pauseMutation.mutate()}
        >
          <Pause className="h-4 w-4" />
          Pause
        </Button>
      )}
      {status === 'paused' && (
        <Button
          variant="outline"
          size="sm"
          disabled={isActionPending}
          onClick={() => resumeMutation.mutate()}
        >
          <Play className="h-4 w-4" />
          Resume
        </Button>
      )}
      {(status === 'running' || status === 'paused') && (
        <Button
          variant="destructive"
          size="sm"
          disabled={isActionPending}
          onClick={() => cancelMutation.mutate()}
        >
          <XCircle className="h-4 w-4" />
          Cancel
        </Button>
      )}
    </div>
  );
}

function TasksTable({ tasks }: { tasks: WorkflowTask[] }): JSX.Element {
  const navigate = useNavigate();

  if (tasks.length === 0) {
    return <p className="py-4 text-center text-sm text-muted">No tasks for this workflow.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Agent</TableHead>
          <TableHead>Duration</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tasks.map((task) => {
          const status = resolveStatus(task);
          return (
            <TableRow
              key={task.id}
              className="cursor-pointer"
              onClick={() => navigate(`/work/tasks/${task.id}`)}
            >
              <TableCell className="font-medium">{task.title ?? task.name ?? task.id}</TableCell>
              <TableCell className="capitalize">{task.role ?? '-'}</TableCell>
              <TableCell>
                <Badge variant={statusBadgeVariant(status)} className="capitalize">
                  {status.replace(/_/g, ' ')}
                </Badge>
              </TableCell>
              <TableCell>{task.agent_name ?? task.agent_id ?? '-'}</TableCell>
              <TableCell>{formatDuration(task.duration_seconds)}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/* ------------------------------------------------------------------ */
/*  Flow Tab                                                           */
/* ------------------------------------------------------------------ */

function FlowTab({
  phases,
  tasks,
  onTaskClick,
}: {
  phases: WorkflowPhase[];
  tasks: WorkflowTask[];
  onTaskClick: (taskId: string) => void;
}): JSX.Element {
  const { nodes, edges } = useMemo(
    () => buildSwimlaneGraph(phases, tasks, onTaskClick),
    [phases, tasks, onTaskClick],
  );

  if (phases.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted">
          No phase data available for flow visualization.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div style={{ height: 500 }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Config Tab                                                         */
/* ------------------------------------------------------------------ */

function ConfigTab({ workflowId }: { workflowId: string }): JSX.Element {
  const { data, isLoading, error } = useQuery({
    queryKey: ['workflow-config', workflowId],
    queryFn: () => dashboardApi.getResolvedWorkflowConfig(workflowId, true),
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-4 text-sm text-red-600">
          Failed to load configuration.
        </CardContent>
      </Card>
    );
  }

  const config = data as DashboardResolvedConfigResponse;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Resolved Configuration</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-md border bg-border/10 p-4 text-xs">
            {JSON.stringify(config.resolved_config, null, 2)}
          </pre>
        </CardContent>
      </Card>

      {config.config_layers && Object.keys(config.config_layers).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Config Layers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {Object.entries(config.config_layers).map(([layerName, layerValue]) => (
              <div key={layerName}>
                <p className="mb-1 text-sm font-medium capitalize">{layerName}</p>
                <pre className="overflow-x-auto rounded-md border bg-border/10 p-3 text-xs">
                  {JSON.stringify(layerValue, null, 2)}
                </pre>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Documents Tab                                                      */
/* ------------------------------------------------------------------ */

function DocumentsTab({ workflowId }: { workflowId: string }): JSX.Element {
  const [previewDoc, setPreviewDoc] = useState<DashboardResolvedDocumentReference | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['workflow-documents', workflowId],
    queryFn: () => dashboardApi.listWorkflowDocuments(workflowId),
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-4 text-sm text-red-600">
          Failed to load documents.
        </CardContent>
      </Card>
    );
  }

  const documents = (data ?? []) as DashboardResolvedDocumentReference[];

  if (documents.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted">
          No documents or artifacts for this workflow.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Title</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((doc) => (
                <TableRow key={doc.logical_name}>
                  <TableCell className="font-medium">{doc.logical_name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="capitalize">
                      {doc.scope}
                    </Badge>
                  </TableCell>
                  <TableCell className="capitalize">{doc.source}</TableCell>
                  <TableCell>{doc.title ?? '-'}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPreviewDoc(doc)}
                    >
                      Preview
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {previewDoc && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm">{previewDoc.logical_name}</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setPreviewDoc(null)}>
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent>
            {previewDoc.description && (
              <p className="mb-2 text-sm text-muted">{previewDoc.description}</p>
            )}
            <pre className="overflow-x-auto rounded-md border bg-border/10 p-3 text-xs">
              {JSON.stringify(previewDoc.metadata, null, 2)}
            </pre>
            {previewDoc.artifact?.download_url && (
              <a
                href={previewDoc.artifact.download_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-sm text-accent hover:underline"
              >
                Download artifact
              </a>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  History Tab                                                        */
/* ------------------------------------------------------------------ */

function HistoryTab({ workflowId }: { workflowId: string }): JSX.Element {
  const { data, isLoading, error } = useQuery({
    queryKey: ['workflow-events', workflowId],
    queryFn: () =>
      dashboardApi.listEvents({ entity_type: 'workflow', entity_id: workflowId, per_page: '50' }),
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-4 text-sm text-red-600">
          Failed to load history.
        </CardContent>
      </Card>
    );
  }

  const events = ((data as { data?: DashboardEventRecord[] })?.data ?? []) as DashboardEventRecord[];

  if (events.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted">
          No state change history available.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="relative space-y-0">
          {events.map((event, idx) => (
            <div key={event.id} className="flex gap-4">
              <div className="flex flex-col items-center">
                <div className="h-3 w-3 rounded-full border-2 border-accent bg-surface" />
                {idx < events.length - 1 && <div className="w-0.5 flex-1 bg-border" />}
              </div>
              <div className="pb-6">
                <p className="text-sm font-medium">{event.type.replace(/_/g, ' ')}</p>
                <p className="text-xs text-muted">
                  {new Date(event.created_at).toLocaleString()}
                </p>
                {event.data && Object.keys(event.data).length > 0 && (
                  <pre className="mt-1 overflow-x-auto rounded border bg-border/10 p-2 text-xs">
                    {JSON.stringify(event.data, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Memory Tab                                                         */
/* ------------------------------------------------------------------ */

function MemoryTab({ workflowId }: { workflowId: string }): JSX.Element {
  const queryClient = useQueryClient();
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  const { data: workflowData, isLoading } = useQuery({
    queryKey: ['workflow', workflowId],
    queryFn: () => dashboardApi.getWorkflow(workflowId),
  });

  const workflow = workflowData ? normalizeWorkflow(workflowData) : null;
  const projectId = workflow?.project_id;

  const { data: projectData } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => dashboardApi.getProject(projectId!),
    enabled: Boolean(projectId),
  });

  const patchMutation = useMutation({
    mutationFn: (payload: { key: string; value: unknown }) =>
      dashboardApi.patchProjectMemory(projectId!, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    },
  });

  const memory = (projectData?.memory ?? {}) as Record<string, unknown>;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted" />
        </CardContent>
      </Card>
    );
  }

  if (!projectId) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted">
          No project associated with this workflow. Memory is project-scoped.
        </CardContent>
      </Card>
    );
  }

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
          <CardTitle>Project Memory</CardTitle>
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
/*  Task Slide-over                                                    */
/* ------------------------------------------------------------------ */

function TaskSlideOver({
  taskId,
  onClose,
}: {
  taskId: string;
  onClose: () => void;
}): JSX.Element {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => dashboardApi.getTask(taskId),
    enabled: Boolean(taskId),
  });

  const task = data
    ? ((data as { data?: unknown }).data as WorkflowTask | undefined) ?? (data as WorkflowTask)
    : null;

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex w-96 flex-col border-l border-border bg-surface shadow-xl">
      <div className="flex items-center justify-between border-b border-border p-4">
        <h3 className="font-semibold">Task Detail</h3>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted" />
          </div>
        )}
        {task && (
          <div className="space-y-4">
            <div>
              <p className="text-xs text-muted">Name</p>
              <p className="font-medium">{task.title ?? task.name ?? task.id}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Status</p>
              <Badge variant={statusBadgeVariant(resolveStatus(task))} className="capitalize mt-1">
                {resolveStatus(task).replace(/_/g, ' ')}
              </Badge>
            </div>
            <div>
              <p className="text-xs text-muted">Role</p>
              <p className="text-sm capitalize">{task.role ?? '-'}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Agent</p>
              <p className="text-sm">{task.agent_name ?? task.agent_id ?? '-'}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Duration</p>
              <p className="text-sm">{formatDuration(task.duration_seconds)}</p>
            </div>
            {task.output !== undefined && task.output !== null && (
              <div>
                <p className="text-xs text-muted">Output</p>
                <pre className="mt-1 overflow-x-auto rounded border bg-border/10 p-2 text-xs">
                  {typeof task.output === 'string'
                    ? task.output
                    : JSON.stringify(task.output, null, 2)}
                </pre>
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => navigate(`/work/tasks/${taskId}`)}
            >
              <ChevronRight className="h-4 w-4" />
              Open Full Detail
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Add Task Dialog                                                    */
/* ------------------------------------------------------------------ */

interface AddTaskPayload {
  name: string;
  phase: string;
  role: string;
  input_template: string;
  dependencies: string[];
}

function AddTaskDialog({
  isOpen,
  onOpenChange,
  workflowId,
  phases,
  existingTasks,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  workflowId: string;
  phases: WorkflowPhase[];
  existingTasks: WorkflowTask[];
}): JSX.Element {
  const queryClient = useQueryClient();
  const [taskName, setTaskName] = useState('');
  const [selectedPhase, setSelectedPhase] = useState('');
  const [role, setRole] = useState('');
  const [inputTemplate, setInputTemplate] = useState('');
  const [selectedDeps, setSelectedDeps] = useState<string[]>([]);

  const addMutation = useMutation({
    mutationFn: async (payload: AddTaskPayload) => {
      const session = (await import('../../lib/session.js')).readSession();
      const baseUrl = import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (session?.accessToken) {
        headers.Authorization = `Bearer ${session.accessToken}`;
      }
      const response = await fetch(`${baseUrl}/api/v1/workflows/${workflowId}/tasks`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow', workflowId] });
      resetForm();
      onOpenChange(false);
    },
  });

  function resetForm(): void {
    setTaskName('');
    setSelectedPhase('');
    setRole('');
    setInputTemplate('');
    setSelectedDeps([]);
  }

  function toggleDependency(taskId: string): void {
    setSelectedDeps((prev) =>
      prev.includes(taskId) ? prev.filter((d) => d !== taskId) : [...prev, taskId],
    );
  }

  function handleSubmit(): void {
    if (!taskName.trim()) return;
    addMutation.mutate({
      name: taskName.trim(),
      phase: selectedPhase,
      role,
      input_template: inputTemplate,
      dependencies: selectedDeps,
    });
  }

  const isSubmitDisabled = !taskName.trim() || addMutation.isPending;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) resetForm(); onOpenChange(open); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Task to Workflow</DialogTitle>
          <DialogDescription>Inject a new task into the running workflow.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Task Name</label>
            <Input
              placeholder="Enter task name"
              value={taskName}
              onChange={(e) => setTaskName(e.target.value)}
            />
          </div>

          {phases.length > 0 && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Phase</label>
              <Select value={selectedPhase} onValueChange={setSelectedPhase}>
                <SelectTrigger>
                  <SelectValue placeholder="Select phase" />
                </SelectTrigger>
                <SelectContent>
                  {phases.map((p) => (
                    <SelectItem key={p.name} value={p.name}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Role</label>
            <Input
              placeholder="e.g. developer, reviewer"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Input Template</label>
            <Textarea
              placeholder="Task input template or instructions..."
              value={inputTemplate}
              onChange={(e) => setInputTemplate(e.target.value)}
              className="min-h-[80px] font-mono text-xs"
            />
          </div>

          {existingTasks.length > 0 && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Dependencies</label>
              <div className="max-h-32 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                {existingTasks.map((task) => (
                  <label key={task.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedDeps.includes(task.id)}
                      onChange={() => toggleDependency(task.id)}
                      className="rounded"
                    />
                    <span className="truncate">{task.title ?? task.name ?? task.id}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {addMutation.isError && (
            <p className="text-sm text-red-600">Failed to add task. Please try again.</p>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={isSubmitDisabled} onClick={handleSubmit}>
              {addMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Add Task
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page                                                          */
/* ------------------------------------------------------------------ */

export function WorkflowDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [isAddTaskOpen, setIsAddTaskOpen] = useState(false);
  const [isChainOpen, setIsChainOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['workflow', id],
    queryFn: () => dashboardApi.getWorkflow(id!),
    enabled: Boolean(id),
  });

  const handleTaskClick = useCallback((taskId: string) => {
    setSelectedTaskId(taskId);
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-red-600">Failed to load workflow. Please try again later.</div>
    );
  }

  const workflow = normalizeWorkflow(data);
  const status = resolveStatus(workflow);
  const tasks = workflow.tasks ?? [];
  const phases = workflow.phases ?? [];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{workflow.name}</h1>
          <Badge variant={statusBadgeVariant(status)} className="capitalize">
            {status}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsAddTaskOpen(true)}
          >
            <Plus className="h-4 w-4" />
            Add Task
          </Button>
          {status === 'completed' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsChainOpen(true)}
            >
              <Link2 className="h-4 w-4" />
              Chain Workflow
            </Button>
          )}
          <ActionButtons workflow={workflow} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted">
              <FolderOpen className="h-4 w-4" />
              Project
            </div>
            <p className="mt-1 text-sm font-medium">{workflow.project_name ?? '-'}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted">
              <FileText className="h-4 w-4" />
              Template
            </div>
            <p className="mt-1 text-sm font-medium">{workflow.template_name ?? '-'}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted">
              <Clock className="h-4 w-4" />
              Created
            </div>
            <p className="mt-1 text-sm font-medium">
              {new Date(workflow.created_at).toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted">
              <Clock className="h-4 w-4" />
              Duration
            </div>
            <p className="mt-1 text-sm font-medium">{computeDuration(workflow)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted">
              <DollarSign className="h-4 w-4" />
              Cost
            </div>
            <p className="mt-1 text-sm font-medium">
              {workflow.cost !== undefined && workflow.cost !== null
                ? `$${workflow.cost.toFixed(2)}`
                : '-'}
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="flow">
        <TabsList>
          <TabsTrigger value="flow">Flow</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="config">Config</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="memory">Memory</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="flow">
          <FlowTab phases={phases} tasks={tasks} onTaskClick={handleTaskClick} />
        </TabsContent>

        <TabsContent value="tasks">
          <Card>
            <CardContent className="p-0">
              <TasksTable tasks={tasks} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="config">
          <ConfigTab workflowId={workflow.id} />
        </TabsContent>

        <TabsContent value="documents">
          <DocumentsTab workflowId={workflow.id} />
        </TabsContent>

        <TabsContent value="history">
          <HistoryTab workflowId={workflow.id} />
        </TabsContent>

        <TabsContent value="memory">
          <MemoryTab workflowId={workflow.id} />
        </TabsContent>

        <TabsContent value="logs">
          <Card>
            <CardContent className="pt-6">
              <LogViewer
                scope={{ workflowId: workflow.id }}
                compact
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {selectedTaskId && (
        <TaskSlideOver taskId={selectedTaskId} onClose={() => setSelectedTaskId(null)} />
      )}

      <AddTaskDialog
        isOpen={isAddTaskOpen}
        onOpenChange={setIsAddTaskOpen}
        workflowId={workflow.id}
        phases={phases}
        existingTasks={tasks}
      />
      <ChainWorkflowDialog
        isOpen={isChainOpen}
        onOpenChange={setIsChainOpen}
        sourceWorkflowId={workflow.id}
        defaultTemplateId={workflow.template_id}
        defaultWorkflowName={workflow.name}
      />
    </div>
  );
}
