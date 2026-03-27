export type MissionControlMode = 'live' | 'recent' | 'history';
export type MissionControlRail = 'attention' | 'workflow';
export type MissionControlLens = 'workflows' | 'tasks';
export type MissionControlWorkspaceTab = 'overview' | 'board' | 'outputs' | 'steering' | 'history';

export interface MissionControlShellState {
  mode: MissionControlMode;
  rail: MissionControlRail;
  lens: MissionControlLens;
  workflowId: string | null;
  tab: MissionControlWorkspaceTab;
  savedView: string;
  scope: string;
}

const DEFAULT_SHELL_STATE: MissionControlShellState = {
  mode: 'live',
  rail: 'attention',
  lens: 'workflows',
  workflowId: null,
  tab: 'overview',
  savedView: 'all-active',
  scope: 'entire-tenant',
};

export function readMissionControlShellState(
  searchParams: URLSearchParams,
): MissionControlShellState {
  return {
    mode: readMissionControlMode(searchParams.get('mode')),
    rail: readMissionControlRail(searchParams.get('rail')),
    lens: readMissionControlLens(searchParams.get('lens')),
    workflowId: readOptionalValue(searchParams.get('workflow')),
    tab: readMissionControlWorkspaceTab(searchParams.get('tab')),
    savedView: readOptionalValue(searchParams.get('view')) ?? DEFAULT_SHELL_STATE.savedView,
    scope: readOptionalValue(searchParams.get('scope')) ?? DEFAULT_SHELL_STATE.scope,
  };
}

export function buildMissionControlShellSearchParams(
  current: URLSearchParams,
  patch: Partial<MissionControlShellState>,
): URLSearchParams {
  const nextState = {
    ...readMissionControlShellState(current),
    ...patch,
  };
  const next = new URLSearchParams();

  if (nextState.mode !== DEFAULT_SHELL_STATE.mode) {
    next.set('mode', nextState.mode);
  }
  if (nextState.rail !== DEFAULT_SHELL_STATE.rail) {
    next.set('rail', nextState.rail);
  }
  if (nextState.lens !== DEFAULT_SHELL_STATE.lens) {
    next.set('lens', nextState.lens);
  }
  if (nextState.workflowId) {
    next.set('workflow', nextState.workflowId);
  }
  if (nextState.tab !== DEFAULT_SHELL_STATE.tab) {
    next.set('tab', nextState.tab);
  }
  if (nextState.savedView !== DEFAULT_SHELL_STATE.savedView) {
    next.set('view', nextState.savedView);
  }
  if (nextState.scope !== DEFAULT_SHELL_STATE.scope) {
    next.set('scope', nextState.scope);
  }

  return next;
}

export function buildMissionControlShellHref(
  patch: Partial<MissionControlShellState> = {},
): string {
  const searchParams = buildMissionControlShellSearchParams(new URLSearchParams(), patch);
  const rendered = searchParams.toString();
  return rendered.length > 0 ? `/mission-control?${rendered}` : '/mission-control';
}

export function buildWorkflowDiagnosticsHref(input: {
  workflowId: string;
  taskId?: string | null;
  view?: 'raw' | 'summary';
}): string {
  const searchParams = new URLSearchParams();
  searchParams.set('workflow', input.workflowId);
  if (input.taskId) {
    searchParams.set('task', input.taskId);
  }
  if (input.view === 'summary') {
    searchParams.set('view', 'summary');
  }
  return `/diagnostics/live-logs?${searchParams.toString()}`;
}

function readMissionControlMode(value: string | null): MissionControlMode {
  return value === 'recent' || value === 'history' ? value : DEFAULT_SHELL_STATE.mode;
}

function readMissionControlRail(value: string | null): MissionControlRail {
  return value === 'workflow' ? value : DEFAULT_SHELL_STATE.rail;
}

function readMissionControlLens(value: string | null): MissionControlLens {
  return value === 'tasks' ? value : DEFAULT_SHELL_STATE.lens;
}

function readMissionControlWorkspaceTab(value: string | null): MissionControlWorkspaceTab {
  switch (value) {
    case 'board':
    case 'outputs':
    case 'steering':
    case 'history':
      return value;
    default:
      return DEFAULT_SHELL_STATE.tab;
  }
}

function readOptionalValue(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}
