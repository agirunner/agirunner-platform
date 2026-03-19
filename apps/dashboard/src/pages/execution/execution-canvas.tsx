import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient, useQuery } from '@tanstack/react-query';

import {
  dashboardApi,
  type DashboardPlaybookRecord,
  type DashboardWorkspaceRecord,
  type DashboardEventPage,
  type DashboardApprovalQueueResponse,
  type DashboardWorkflowBoardResponse,
  type DashboardWorkflowBudgetRecord,
  type LogQueryResponse,
} from '../../lib/api.js';
import { subscribeToEvents } from '../../lib/sse.js';
import { useUserPreferences } from '../../lib/use-user-preferences.js';
import {
  initialCanvasState,
  selectWorkflow,
  selectTask,
  clearSelection,
  navigateBreadcrumb,
  type CanvasState,
} from './execution-canvas-support.js';
import { ViewModeSwitcher } from './view-mode-switcher.js';
import { ControlModeSwitcher } from './control-mode-switcher.js';
import { ConnectionIndicator } from './connection-indicator.js';
import { SearchFilterBar } from './search-filter-bar.js';
import { WarRoomView } from './overview/war-room-view.js';
import { DashboardGridView } from './overview/dashboard-grid-view.js';
import { TimelineLanesView, type WorkflowLane } from './overview/timeline-lanes-view.js';
import { DepthDial } from './detail/depth-dial.js';
import { WorkflowDetailPanel } from './detail/workflow-detail-panel.js';
import { TaskKanban, type TaskCard } from './detail/task-kanban.js';
import { AgentTimeline } from './detail/agent-timeline.js';
import type { AgentTurnData } from './detail/agent-timeline-entry.js';
import { RawStreamView } from './detail/raw-stream-view.js';
import { LaunchWizard } from './launch/launch-wizard.js';
import { CommandPalette } from './controls/command-palette.js';
import { buildActionRegistry } from './controls/command-palette-support.js';
import { ResourcePanel } from './resources/resource-panel.js';
import { TimeRangeFilter, type TimeRange, filterByTimeRange } from './time-range-filter.js';

const REFETCH_INTERVAL = 5000;

interface ExecutionCanvasProps {
  initialAction?: 'launch';
}

interface WorkerRecord {
  id?: string;
  status: string;
  capabilities?: string[];
}

function mapBoardToKanbanTasks(board: DashboardWorkflowBoardResponse): TaskCard[] {
  return board.work_items.map((wi) => ({
    id: wi.id,
    title: wi.title,
    role: wi.owner_role ?? undefined,
    state: wi.column_id,
    columnId: wi.column_id,
  }));
}

function mapLogsToTimeline(logs: LogQueryResponse): AgentTurnData[] {
  return logs.data.map((entry, index) => ({
    id: String(entry.id),
    role: entry.role ?? entry.actor_type ?? 'system',
    turn: index + 1,
    summary: entry.operation,
    timestamp: new Date(entry.created_at).toLocaleTimeString(),
    expandedContent: entry.payload
      ? JSON.stringify(entry.payload, null, 2)
      : undefined,
  }));
}

export function ExecutionCanvas({ initialAction }: ExecutionCanvasProps): JSX.Element {
  const queryClient = useQueryClient();
  const [canvasState, setCanvasState] = useState<CanvasState>(() => {
    const state = initialCanvasState();
    return initialAction === 'launch' ? { ...state, launchWizardOpen: true } : state;
  });

  const { preferences, setViewMode, setControlMode, setDepthLevel, toggleStarredPlaybook } = useUserPreferences();

  useEffect(() => {
    setCanvasState((prev) => ({
      ...prev,
      viewMode: preferences.viewMode,
      controlMode: preferences.controlMode,
      depthLevel: preferences.depthLevel,
    }));
  }, [preferences.viewMode, preferences.controlMode, preferences.depthLevel]);

  useEffect(() => {
    const unsubscribe = subscribeToEvents(() => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['workers'] });
      queryClient.invalidateQueries({ queryKey: ['events-recent'] });
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
    });
    return unsubscribe;
  }, [queryClient]);

  const onSelectWorkflow = useCallback((id: string, name: string) => {
    setCanvasState((prev) => selectWorkflow(prev, id, name));
  }, []);

  const onClearSelection = useCallback(() => {
    setCanvasState((prev) => clearSelection(prev));
  }, []);

  const onNewWorkflow = useCallback(() => {
    setCanvasState((prev) => ({ ...prev, launchWizardOpen: true }));
  }, []);

  // Search & filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(true);
  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  const [isAutoScrolling, setIsAutoScrolling] = useState(true);
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');

  // Command palette
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Monitor connection status
  useEffect(() => {
    setIsConnected(true);
  }, []);

  const onSelectTask = useCallback((taskId: string, taskTitle: string) => {
    setCanvasState((prev) => selectTask(prev, taskId, taskTitle));
  }, []);

  const onBreadcrumbNavigate = useCallback((index: number) => {
    setCanvasState((prev) => navigateBreadcrumb(prev, index));
  }, []);

  // Derive data from queries
  const workflowsQuery = useQuery({
    queryKey: ['workflows'],
    queryFn: () => dashboardApi.listWorkflows(),
    refetchInterval: REFETCH_INTERVAL,
  });

  const tasksQuery = useQuery({
    queryKey: ['tasks'],
    queryFn: () => dashboardApi.listTasks(),
    refetchInterval: REFETCH_INTERVAL,
  });

  const workersQuery = useQuery({
    queryKey: ['workers'],
    queryFn: () => dashboardApi.listWorkers(),
    refetchInterval: REFETCH_INTERVAL,
  });

  const playbooks = useQuery({
    queryKey: ['playbooks'],
    queryFn: () => dashboardApi.listPlaybooks(),
  });

  const workspaces = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => dashboardApi.listWorkspaces(),
  });

  const eventsQuery = useQuery({
    queryKey: ['events-recent'],
    queryFn: () => dashboardApi.listEvents(),
    refetchInterval: REFETCH_INTERVAL,
  });

  const approvalsQuery = useQuery({
    queryKey: ['approvals'],
    queryFn: () => dashboardApi.getApprovalQueue(),
    refetchInterval: REFETCH_INTERVAL,
  });

  // Detail panel queries (conditional on focused workflow)
  const focusedWorkflowId = canvasState.panel.workflowId;

  const boardQuery = useQuery({
    queryKey: ['workflow-board', focusedWorkflowId],
    queryFn: () => dashboardApi.getWorkflowBoard(focusedWorkflowId!),
    enabled: !!focusedWorkflowId,
    refetchInterval: REFETCH_INTERVAL,
  });

  const budgetQuery = useQuery({
    queryKey: ['workflow-budget', focusedWorkflowId],
    queryFn: () => dashboardApi.getWorkflowBudget(focusedWorkflowId!),
    enabled: !!focusedWorkflowId,
    refetchInterval: REFETCH_INTERVAL,
  });

  const logsQuery = useQuery({
    queryKey: ['workflow-logs', focusedWorkflowId],
    queryFn: () => dashboardApi.queryLogs({
      workflow_id: focusedWorkflowId!,
      per_page: '100',
    }),
    enabled: !!focusedWorkflowId && canvasState.depthLevel >= 2,
    refetchInterval: REFETCH_INTERVAL,
  });

  // Map API data to component shapes
  const workflows = useMemo(() => {
    const raw = workflowsQuery.data?.data ?? [];

    // Build task lookup by workflow
    const tasksByWorkflow = new Map<string, Array<{ role: string | null; state: string }>>();
    const taskData = (tasksQuery.data as { data?: Array<{ workflow_id: string | null; role: string | null; state: string }> })?.data ?? [];
    for (const t of taskData) {
      if (t.workflow_id === null) continue;
      const list = tasksByWorkflow.get(t.workflow_id) ?? [];
      list.push(t);
      tasksByWorkflow.set(t.workflow_id, list);
    }

    // Build approval lookup by workflow
    const approvals = approvalsQuery.data as DashboardApprovalQueueResponse | undefined;
    const gateWorkflowIds = new Set<string>();
    if (approvals) {
      for (const gate of approvals.stage_gates) {
        if (gate.gate_status === 'pending' || gate.gate_status === 'awaiting_human') {
          gateWorkflowIds.add(gate.workflow_id);
        }
      }
      for (const task of approvals.task_approvals) {
        if (task.workflow_id && (task.state === 'output_pending_review' || task.state === 'escalated')) {
          gateWorkflowIds.add(task.workflow_id);
        }
      }
    }

    return raw.map((w) => {
      const wTasks = tasksByWorkflow.get(w.id) ?? [];
      const activeRoles = [...new Set(
        wTasks
          .filter((t) => t.state === 'in_progress' || t.state === 'claimed')
          .map((t) => t.role)
          .filter((r): r is string => r !== null),
      )];

      const hasFailedTask = wTasks.some((t) => t.state === 'failed');

      return {
        id: w.id,
        name: w.name,
        state: w.state,
        createdAt: w.created_at,
        currentStage: w.current_stage ?? w.active_stages?.[0] ?? undefined,
        playbookName: w.playbook_name ?? undefined,
        workspaceName: w.workspace_name ?? undefined,
        taskCounts: w.task_counts as Record<string, number> | undefined,
        workItemSummary: w.work_item_summary ?? undefined,
        agentRoles: activeRoles,
        needsAttention: w.state === 'failed' || hasFailedTask,
        gateWaiting: gateWorkflowIds.has(w.id),
      };
    });
  }, [workflowsQuery.data, tasksQuery.data, approvalsQuery.data]);

  const filteredWorkflows = useMemo(() => {
    let result = filterByTimeRange(workflows, timeRange, (w) => w.createdAt);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((w) => w.name.toLowerCase().includes(q));
    }
    if (statusFilter === 'active') result = result.filter((w) => w.state === 'active');
    else if (statusFilter === 'completed') result = result.filter((w) => w.state === 'completed');
    else if (statusFilter === 'failed') result = result.filter((w) => w.state === 'failed');
    else if (statusFilter === 'attention' || statusFilter === 'needs-attention') {
      result = result.filter((w) => w.needsAttention || w.gateWaiting);
    }
    return result;
  }, [workflows, searchQuery, statusFilter, timeRange]);

  // Workers: SDK listWorkers() already unwraps .data, returns Worker[]
  const workers = useMemo(() => {
    const raw = (workersQuery.data ?? []) as WorkerRecord[];
    return raw.map((w) => ({ status: w.status ?? 'offline' }));
  }, [workersQuery.data]);

  // Events: listEvents returns DashboardEventPage { data, meta }
  const events = useMemo(() => {
    const page = eventsQuery.data as DashboardEventPage | undefined;
    const raw = page?.data ?? [];
    return raw.map((e) => ({
      id: e.id,
      type: e.type,
      entityType: e.entity_type,
      actorType: e.actor_type,
      data: e.data,
      createdAt: e.created_at,
    }));
  }, [eventsQuery.data]);

  // Cost data from focused workflow budget or aggregate from workflow task counts
  const costData = useMemo(() => {
    const budget = budgetQuery.data as DashboardWorkflowBudgetRecord | undefined;
    if (budget) {
      return { spendUsd: budget.cost_usd, tokenCount: budget.tokens_used };
    }
    // Aggregate: sum completed task counts as proxy for tokens
    let totalTasks = 0;
    for (const w of workflows) {
      if (w.taskCounts) {
        totalTasks += Object.values(w.taskCounts).reduce((sum, v) => sum + (v ?? 0), 0);
      }
    }
    return { spendUsd: -1, tokenCount: totalTasks };
  }, [budgetQuery.data, workflows]);

  // Timeline lanes data — use real stage info from workflow data
  const lanes: WorkflowLane[] = useMemo(() => {
    return filteredWorkflows.map((w) => {
      const summary = w.workItemSummary;
      if (summary && summary.active_stage_names && summary.active_stage_names.length > 0) {
        return {
          id: w.id,
          name: w.name,
          stages: summary.active_stage_names.map((stageName: string) => ({
            name: stageName,
            status: 'active' as const,
            agentRoles: w.agentRoles,
          })),
        };
      }

      const stageName = w.currentStage ?? w.state;
      const status = w.state === 'active'
        ? 'active' as const
        : w.state === 'completed'
          ? 'completed' as const
          : w.state === 'failed'
            ? 'failed' as const
            : w.gateWaiting
              ? 'waiting' as const
              : 'pending' as const;

      return {
        id: w.id,
        name: w.name,
        stages: [{ name: stageName, status, agentRoles: w.agentRoles }],
      };
    });
  }, [filteredWorkflows]);

  // Focused workflow data
  const focusedWorkflow = useMemo(() => {
    if (!canvasState.panel.workflowId) return null;
    return workflows.find((w) => w.id === canvasState.panel.workflowId) ?? null;
  }, [workflows, canvasState.panel.workflowId]);

  // Board data for TaskKanban
  const kanbanData = useMemo(() => {
    const board = boardQuery.data as DashboardWorkflowBoardResponse | undefined;
    if (!board) return { columns: [], tasks: [] };
    return {
      columns: board.columns.map((c) => ({
        id: c.id,
        name: c.label,
        isTerminal: c.is_terminal,
      })),
      tasks: mapBoardToKanbanTasks(board),
    };
  }, [boardQuery.data]);

  // Timeline entries from logs
  const timelineEntries = useMemo(() => {
    const logData = logsQuery.data as LogQueryResponse | undefined;
    if (!logData) return [];
    return mapLogsToTimeline(logData);
  }, [logsQuery.data]);

  // Command palette actions
  const paletteActions = useMemo(() => {
    return buildActionRegistry(
      workflows,
      (id) => {
        const w = workflows.find((wf) => wf.id === id);
        if (w) onSelectWorkflow(w.id, w.name);
      },
      () => {},
      onNewWorkflow,
    );
  }, [workflows, onSelectWorkflow, onNewWorkflow]);

  const isWorkflowFocused = canvasState.panel.isOpen;

  // Render depth content
  function renderDepthContent() {
    if (!focusedWorkflow) return null;
    switch (canvasState.depthLevel) {
      case 1:
        return (
          <TaskKanban
            columns={kanbanData.columns.length > 0
              ? kanbanData.columns
              : [
                  { id: 'planned', name: 'Planned' },
                  { id: 'active', name: 'Active' },
                  { id: 'review', name: 'Review' },
                  { id: 'done', name: 'Done', isTerminal: true },
                ]}
            tasks={kanbanData.tasks}
            onSelectTask={onSelectTask}
          />
        );
      case 2:
        return (
          <AgentTimeline
            entries={timelineEntries}
            roleFilter={roleFilter}
            onRoleFilterChange={setRoleFilter}
            isAutoScrolling={isAutoScrolling}
            onToggleAutoScroll={() => setIsAutoScrolling((prev) => !prev)}
          />
        );
      case 3:
        return (
          <RawStreamView
            taskId={canvasState.panel.taskId}
            agentFilter={roleFilter}
            onAgentFilterChange={setRoleFilter}
            isAutoScrolling={isAutoScrolling}
            onToggleAutoScroll={() => setIsAutoScrolling((prev) => !prev)}
          />
        );
      default:
        return null;
    }
  }

  // Render overview mode
  function renderOverview() {
    const spendDisplay = costData.spendUsd >= 0 ? costData.spendUsd : 0;
    switch (canvasState.viewMode) {
      case 'war-room':
        return (
          <WarRoomView
            workflows={filteredWorkflows}
            workers={workers}
            events={events}
            spendUsd={spendDisplay}
            tokenCount={costData.tokenCount}
            onSelectWorkflow={(id) => {
              const w = workflows.find((wf) => wf.id === id);
              onSelectWorkflow(id, w?.name ?? 'Workflow');
            }}
            controlMode={canvasState.controlMode}
          />
        );
      case 'dashboard-grid':
        return (
          <DashboardGridView
            workflows={filteredWorkflows}
            events={events}
            spendUsd={spendDisplay}
            onSelectWorkflow={(id) => {
              const w = workflows.find((wf) => wf.id === id);
              onSelectWorkflow(id, w?.name ?? 'Workflow');
            }}
          />
        );
      case 'timeline-lanes':
        return (
          <TimelineLanesView
            lanes={lanes}
            onSelectStage={(workflowId) => {
              const w = workflows.find((wf) => wf.id === workflowId);
              onSelectWorkflow(workflowId, w?.name ?? 'Workflow');
            }}
          />
        );
      default:
        return null;
    }
  }

  return (
    <div
      data-testid="execution-canvas"
      className="font-[var(--font-family)]"
    >
      <style>{`
        @media (max-width: 767px) {
          .depth-dial-hidden-mobile { display: none !important; }
        }
      `}</style>

      {/* Top Bar */}
      <header
        data-testid="execution-top-bar"
        className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border-default)]"
      >
        <ViewModeSwitcher
          value={canvasState.viewMode}
          onChange={(mode) => {
            setViewMode(mode);
            setCanvasState((prev) => ({ ...prev, viewMode: mode }));
          }}
        />

        <ControlModeSwitcher
          value={canvasState.controlMode}
          onChange={(mode) => {
            setControlMode(mode);
            setCanvasState((prev) => ({ ...prev, controlMode: mode }));
          }}
        />

        {isWorkflowFocused && (
          <DepthDial
            value={canvasState.depthLevel}
            onChange={(level) => {
              setDepthLevel(level);
              setCanvasState((prev) => ({ ...prev, depthLevel: level }));
            }}
          />
        )}

        <div className="flex-1 min-w-0">
          <SearchFilterBar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
          />
        </div>

        <TimeRangeFilter value={timeRange} onChange={setTimeRange} />

        <button
          data-testid="new-workflow-btn"
          type="button"
          onClick={onNewWorkflow}
          className="shrink-0 rounded-md bg-[var(--color-accent-primary)] px-4 py-2 text-xs font-medium text-white whitespace-nowrap transition-all duration-150 hover:opacity-90 active:scale-[0.97]"
        >
          + New Workflow
        </button>

        <ConnectionIndicator isConnected={isConnected} />
      </header>

      {/* Main Canvas */}
      <main data-testid="execution-main" className="p-4">
        {renderOverview()}
      </main>

      {/* Detail Panel */}
      {isWorkflowFocused && focusedWorkflow && (
        <WorkflowDetailPanel
          workflow={{
            id: focusedWorkflow.id,
            name: focusedWorkflow.name,
            state: focusedWorkflow.state,
            currentStage: focusedWorkflow.currentStage,
          }}
          depthLevel={canvasState.depthLevel}
          onDepthChange={(level) => {
            setDepthLevel(level);
            setCanvasState((prev) => ({ ...prev, depthLevel: level }));
          }}
          breadcrumb={canvasState.panel.breadcrumb}
          onBreadcrumbNavigate={onBreadcrumbNavigate}
          onClose={onClearSelection}
          onOpenResources={() => setCanvasState((prev) => ({ ...prev, resourcePanelOpen: true }))}
        >
          {renderDepthContent()}
        </WorkflowDetailPanel>
      )}

      {/* Resource Panel */}
      <ResourcePanel
        isOpen={canvasState.resourcePanelOpen}
        onClose={() => setCanvasState((prev) => ({ ...prev, resourcePanelOpen: false }))}
        workflowId={canvasState.panel.workflowId ?? ''}
        workspaceId=""
      />

      {/* Launch Wizard */}
      <LaunchWizard
        isOpen={canvasState.launchWizardOpen}
        onClose={() => setCanvasState((prev) => ({ ...prev, launchWizardOpen: false }))}
        onLaunch={() => {
          setCanvasState((prev) => ({ ...prev, launchWizardOpen: false }));
        }}
        playbooks={(playbooks.data?.data ?? []).map((p: DashboardPlaybookRecord) => ({
          id: p.id,
          name: p.name,
          stageCount: (p as any).definition?.stages?.length ?? 0,
          roleCount: (p as any).definition?.roles?.length ?? 0,
        }))}
        workspaces={(workspaces.data?.data ?? []).map((ws: DashboardWorkspaceRecord) => ({
          id: ws.id,
          name: ws.name,
        }))}
        starredPlaybookIds={preferences.starredPlaybooks}
        onTogglePlaybookStar={toggleStarredPlaybook}
      />

      {/* Command Palette */}
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        actions={paletteActions}
      />
    </div>
  );
}

export default ExecutionCanvas;
