export type WorkflowPageMode = 'live' | 'recent';
export type WorkflowWorkbenchTab =
  | 'needs_action'
  | 'steering'
  | 'live_console'
  | 'history'
  | 'deliverables';
export type WorkflowBoardMode = 'active' | 'active_recent_complete' | 'all';

export interface WorkflowsPageState {
  mode: WorkflowPageMode;
  workflowId: string | null;
  workItemId: string | null;
  tab: WorkflowWorkbenchTab | null;
  search: string;
  needsActionOnly: boolean;
  ongoingOnly: boolean;
  boardMode: WorkflowBoardMode;
}

const DEFAULT_STATE: WorkflowsPageState = {
  mode: 'live',
  workflowId: null,
  workItemId: null,
  tab: null,
  search: '',
  needsActionOnly: false,
  ongoingOnly: false,
  boardMode: 'active_recent_complete',
};

export function readWorkflowsPageState(searchParams: URLSearchParams): WorkflowsPageState {
  return {
    mode: readMode(searchParams.get('mode')),
    workflowId: readOptionalValue(searchParams.get('workflow')),
    workItemId: readOptionalValue(searchParams.get('work_item')),
    tab: readTab(searchParams.get('tab')),
    search: readOptionalValue(searchParams.get('q')) ?? '',
    needsActionOnly: readBooleanFlag(searchParams.get('needs_action_only')),
    ongoingOnly: readBooleanFlag(searchParams.get('ongoing_only')),
    boardMode: readBoardMode(searchParams.get('board_mode')),
  };
}

export function buildWorkflowsPageSearchParams(
  current: URLSearchParams,
  patch: Partial<WorkflowsPageState>,
): URLSearchParams {
  const nextState = {
    ...readWorkflowsPageState(current),
    ...patch,
  };
  const next = new URLSearchParams();

  if (nextState.mode !== DEFAULT_STATE.mode) {
    next.set('mode', nextState.mode);
  }
  if (nextState.workflowId) {
    next.set('workflow', nextState.workflowId);
  }
  if (nextState.workItemId) {
    next.set('work_item', nextState.workItemId);
  }
  if (nextState.tab) {
    next.set('tab', nextState.tab);
  }
  if (nextState.search.trim().length > 0) {
    next.set('q', nextState.search.trim());
  }
  if (nextState.needsActionOnly) {
    next.set('needs_action_only', '1');
  }
  if (nextState.ongoingOnly) {
    next.set('ongoing_only', '1');
  }
  if (nextState.boardMode !== DEFAULT_STATE.boardMode) {
    next.set('board_mode', nextState.boardMode);
  }

  return next;
}

export function buildWorkflowsPageHref(patch: Partial<WorkflowsPageState> = {}): string {
  const searchParams = buildWorkflowsPageSearchParams(new URLSearchParams(), patch);
  const rendered = searchParams.toString();
  return rendered.length > 0 ? `/workflows?${rendered}` : '/workflows';
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

function readMode(value: string | null): WorkflowPageMode {
  return value === 'recent' || value === 'history' ? 'recent' : DEFAULT_STATE.mode;
}

function readTab(value: string | null): WorkflowWorkbenchTab | null {
  switch (value) {
    case 'needs_action':
    case 'steering':
    case 'live_console':
    case 'history':
    case 'deliverables':
      return value;
    default:
      return null;
  }
}

function readBoardMode(value: string | null): WorkflowBoardMode {
  switch (value) {
    case 'active':
    case 'all':
      return value;
    default:
      return DEFAULT_STATE.boardMode;
  }
}

function readBooleanFlag(value: string | null): boolean {
  return value === '1' || value === 'true';
}

function readOptionalValue(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}
