import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient, useQuery } from '@tanstack/react-query';

import { dashboardApi, type DashboardPlaybookRecord, type DashboardWorkspaceRecord, type DashboardEventRecord } from '../../lib/api.js';
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
import { ConnectionIndicator } from './connection-indicator.js';
import { SearchFilterBar } from './search-filter-bar.js';
import { WarRoomView } from './overview/war-room-view.js';
import { DashboardGridView } from './overview/dashboard-grid-view.js';
import { TimelineLanesView, type WorkflowLane } from './overview/timeline-lanes-view.js';
import { DepthDial } from './detail/depth-dial.js';
import { WorkflowDetailPanel } from './detail/workflow-detail-panel.js';
import { TaskKanban } from './detail/task-kanban.js';
import { AgentTimeline } from './detail/agent-timeline.js';
import { RawStreamView } from './detail/raw-stream-view.js';
import { LaunchWizard } from './launch/launch-wizard.js';
import { CommandPalette } from './controls/command-palette.js';
import { buildActionRegistry } from './controls/command-palette-support.js';
import { ResourcePanel } from './resources/resource-panel.js';

const REFETCH_INTERVAL = 5000;

interface ExecutionCanvasProps {
  initialAction?: 'launch';
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
    queryFn: () => dashboardApi.listEvents?.() ?? Promise.resolve({ data: [] }),
    refetchInterval: REFETCH_INTERVAL,
  });

  // Map API data to component shapes
  const workflows = useMemo(() => {
    const raw = workflowsQuery.data?.data ?? [];
    return raw.map((w) => ({
      id: w.id,
      name: w.name,
      state: w.state,
      currentStage: w.current_stage ?? w.active_stages?.[0],
      agentRoles: [] as string[],
      needsAttention: w.state === 'failed',
      gateWaiting: false,
    }));
  }, [workflowsQuery.data]);

  const filteredWorkflows = useMemo(() => {
    let result = workflows;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((w) => w.name.toLowerCase().includes(q));
    }
    if (statusFilter === 'active') result = result.filter((w) => w.state === 'active');
    else if (statusFilter === 'completed') result = result.filter((w) => w.state === 'completed');
    else if (statusFilter === 'failed') result = result.filter((w) => w.state === 'failed');
    else if (statusFilter === 'attention') result = result.filter((w) => w.needsAttention || w.gateWaiting);
    return result;
  }, [workflows, searchQuery, statusFilter]);

  const workers = useMemo(() => {
    const raw = workersQuery.data as Array<{ status: string }> | undefined;
    return (raw ?? []).map((w) => ({ status: w.status ?? 'offline' }));
  }, [workersQuery.data]);

  const events = useMemo(() => {
    const raw = (eventsQuery.data as unknown as { data?: DashboardEventRecord[] })?.data ?? [];
    return raw.map((e) => ({
      id: e.id,
      type: e.type,
      entityType: e.entity_type,
      actorType: e.actor_type,
      data: e.data,
      createdAt: e.created_at,
    }));
  }, [eventsQuery.data]);

  // Timeline lanes data
  const lanes: WorkflowLane[] = useMemo(() => {
    return filteredWorkflows.map((w) => ({
      id: w.id,
      name: w.name,
      stages: [
        { name: w.currentStage ?? w.state, status: w.state === 'active' ? 'active' as const : w.state === 'completed' ? 'completed' as const : w.state === 'failed' ? 'failed' as const : 'pending' as const },
      ],
    }));
  }, [filteredWorkflows]);

  // Focused workflow data
  const focusedWorkflow = useMemo(() => {
    if (!canvasState.panel.workflowId) return null;
    return workflows.find((w) => w.id === canvasState.panel.workflowId) ?? null;
  }, [workflows, canvasState.panel.workflowId]);

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
            columns={[
              { id: 'planned', name: 'Planned' },
              { id: 'active', name: 'Active' },
              { id: 'review', name: 'Review' },
              { id: 'done', name: 'Done', isTerminal: true },
            ]}
            tasks={[]}
            onSelectTask={onSelectTask}
          />
        );
      case 2:
        return (
          <AgentTimeline
            entries={[]}
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
    switch (canvasState.viewMode) {
      case 'war-room':
        return (
          <WarRoomView
            workflows={filteredWorkflows}
            workers={workers}
            events={events}
            spendUsd={0}
            tokenCount={0}
            onSelectWorkflow={(id) => {
              const w = workflows.find((wf) => wf.id === id);
              onSelectWorkflow(id, w?.name ?? 'Workflow');
            }}
          />
        );
      case 'dashboard-grid':
        return (
          <DashboardGridView
            workflows={filteredWorkflows}
            events={events}
            spendUsd={0}
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
      style={{
        backgroundColor: 'var(--color-bg-primary)',
        fontFamily: 'var(--font-family)',
        minHeight: '100vh',
      }}
    >
      <style>{`
        @media (max-width: 767px) {
          .depth-dial-hidden-mobile { display: none !important; }
        }
      `}</style>

      {/* Top Bar */}
      <header
        data-testid="execution-top-bar"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '12px 16px',
          borderBottom: '1px solid var(--color-border-default)',
        }}
      >
        <ViewModeSwitcher
          value={canvasState.viewMode}
          onChange={(mode) => {
            setViewMode(mode);
            setCanvasState((prev) => ({ ...prev, viewMode: mode }));
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

        <div style={{ flex: 1 }}>
          <SearchFilterBar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            playbookFilter={null}
            onPlaybookFilterChange={() => {}}
            workspaceFilter={null}
            onWorkspaceFilterChange={() => {}}
          />
        </div>

        <button
          data-testid="new-workflow-btn"
          type="button"
          onClick={onNewWorkflow}
          style={{
            backgroundColor: 'var(--color-accent-primary)',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            padding: '6px 14px',
            fontSize: '11px',
            fontFamily: 'var(--font-family)',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          + New Workflow
        </button>
      </header>

      {/* Main Canvas */}
      <main data-testid="execution-main" style={{ padding: '16px' }}>
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
          stageCount: 0,
          roleCount: 0,
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

      {/* Connection Indicator */}
      <ConnectionIndicator isConnected={isConnected} />
    </div>
  );
}

export default ExecutionCanvas;
