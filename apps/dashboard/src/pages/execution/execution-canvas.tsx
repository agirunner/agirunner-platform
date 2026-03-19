import { useCallback, useEffect, useState } from 'react';
import { useQueryClient, useQuery } from '@tanstack/react-query';

import { dashboardApi } from '../../lib/api.js';
import { subscribeToEvents } from '../../lib/sse.js';
import { useUserPreferences } from '../../lib/use-user-preferences.js';
import {
  initialCanvasState,
  selectWorkflow,
  clearSelection,
  type CanvasState,
} from './execution-canvas-support.js';

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

  const { preferences, setViewMode, setControlMode, setDepthLevel } = useUserPreferences();

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

  useQuery({
    queryKey: ['workflows'],
    queryFn: () => dashboardApi.listWorkflows(),
    refetchInterval: REFETCH_INTERVAL,
  });

  useQuery({
    queryKey: ['tasks'],
    queryFn: () => dashboardApi.listTasks(),
    refetchInterval: REFETCH_INTERVAL,
  });

  useQuery({
    queryKey: ['workers'],
    queryFn: () => dashboardApi.listWorkers(),
    refetchInterval: REFETCH_INTERVAL,
  });

  const onSelectWorkflow = useCallback((id: string, name: string) => {
    setCanvasState((prev) => selectWorkflow(prev, id, name));
  }, []);

  const onClearSelection = useCallback(() => {
    setCanvasState((prev) => clearSelection(prev));
  }, []);

  const onNewWorkflow = useCallback(() => {
    setCanvasState((prev) => ({ ...prev, launchWizardOpen: true }));
  }, []);

  void setViewMode;
  void setControlMode;
  void setDepthLevel;
  void onSelectWorkflow;
  void onClearSelection;

  return (
    <div
      data-testid="execution-canvas"
      style={{
        backgroundColor: 'var(--color-bg-primary)',
        fontFamily: 'var(--font-family)',
        minHeight: '100vh',
      }}
    >
      <header data-testid="execution-top-bar" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px' }}>
        <div data-testid="view-switcher-slot" />
        <div data-testid="depth-dial-slot" />
        <div data-testid="search-slot" />
        <button data-testid="new-workflow-btn" type="button" onClick={onNewWorkflow}>
          + New Workflow
        </button>
      </header>

      <main data-testid="execution-main">
        <div data-testid="overview-slot">{canvasState.viewMode}</div>
      </main>

      {canvasState.panel.isOpen && (
        <aside data-testid="detail-panel-slot" />
      )}

      <div data-testid="connection-indicator-slot" />
    </div>
  );
}
