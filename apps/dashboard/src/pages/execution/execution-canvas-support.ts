export type ViewMode = 'war-room' | 'dashboard-grid' | 'timeline-lanes';
export type ControlMode = 'inline' | 'command-center' | 'command-palette';
export type DepthLevel = 1 | 2 | 3;

export interface BreadcrumbEntry {
  type: 'overview' | 'workflow' | 'task';
  id?: string;
  label: string;
}

export interface PanelState {
  isOpen: boolean;
  workflowId: string | null;
  taskId: string | null;
  breadcrumb: BreadcrumbEntry[];
}

export interface CanvasState {
  viewMode: ViewMode;
  controlMode: ControlMode;
  depthLevel: DepthLevel;
  panel: PanelState;
  resourcePanelOpen: boolean;
  launchWizardOpen: boolean;
  commandPaletteOpen: boolean;
}

const OVERVIEW_ENTRY: BreadcrumbEntry = { type: 'overview', label: 'Overview' };

export function initialCanvasState(): CanvasState {
  return {
    viewMode: 'war-room',
    controlMode: 'inline',
    depthLevel: 1,
    panel: {
      isOpen: false,
      workflowId: null,
      taskId: null,
      breadcrumb: [OVERVIEW_ENTRY],
    },
    resourcePanelOpen: false,
    launchWizardOpen: false,
    commandPaletteOpen: false,
  };
}

export function selectWorkflow(
  state: CanvasState,
  workflowId: string,
  workflowName: string,
): CanvasState {
  const breadcrumb: BreadcrumbEntry[] = [
    OVERVIEW_ENTRY,
    { type: 'workflow', id: workflowId, label: workflowName },
  ];
  return {
    ...state,
    panel: {
      isOpen: true,
      workflowId,
      taskId: null,
      breadcrumb,
    },
  };
}

export function selectTask(
  state: CanvasState,
  taskId: string,
  taskName: string,
): CanvasState {
  if (!state.panel.isOpen || state.panel.workflowId === null) {
    return state;
  }
  const workflowEntry = state.panel.breadcrumb.find((e) => e.type === 'workflow');
  const breadcrumb: BreadcrumbEntry[] = [
    OVERVIEW_ENTRY,
    workflowEntry ?? { type: 'workflow', id: state.panel.workflowId, label: '' },
    { type: 'task', id: taskId, label: taskName },
  ];
  return {
    ...state,
    panel: {
      ...state.panel,
      taskId,
      breadcrumb,
    },
  };
}

export function clearSelection(state: CanvasState): CanvasState {
  return {
    ...state,
    panel: {
      isOpen: false,
      workflowId: null,
      taskId: null,
      breadcrumb: [OVERVIEW_ENTRY],
    },
  };
}

export function navigateBreadcrumb(state: CanvasState, index: number): CanvasState {
  if (index === 0) {
    return clearSelection(state);
  }
  const entry = state.panel.breadcrumb[index];
  if (!entry || entry.type !== 'workflow') {
    return state;
  }
  return {
    ...state,
    panel: {
      isOpen: true,
      workflowId: entry.id ?? null,
      taskId: null,
      breadcrumb: state.panel.breadcrumb.slice(0, index + 1),
    },
  };
}

export function buildBreadcrumb(panel: PanelState): BreadcrumbEntry[] {
  return panel.breadcrumb;
}
