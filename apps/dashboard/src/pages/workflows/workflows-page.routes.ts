export type WorkflowPageMode = 'live' | 'recent';
export type WorkflowWorkbenchTab =
  | 'details'
  | 'needs_action'
  | 'live_console'
  | 'deliverables';
export type WorkflowBoardMode = 'active' | 'active_recent_complete' | 'all';
export type WorkflowTabScope = 'workflow' | 'selected_work_item';

export interface WorkflowLaunchRequest {
  isRequested: boolean;
  playbookId: string | null;
}

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

export function readWorkflowsPageState(
  pathname: string,
  searchParams: URLSearchParams,
): WorkflowsPageState {
  return {
    mode: readMode(searchParams.get('mode')),
    workflowId:
      readWorkflowIdFromPath(pathname) ?? readOptionalValue(searchParams.get('workflow')),
    workItemId:
      readOptionalValue(searchParams.get('work_item_id')) ??
      readOptionalValue(searchParams.get('work_item')),
    tab: readTab(searchParams.get('tab')),
    search:
      readOptionalValue(searchParams.get('search')) ??
      readOptionalValue(searchParams.get('q')) ??
      '',
    needsActionOnly: readBooleanFlag(searchParams.get('needs_action_only')),
    ongoingOnly: readBooleanFlag(searchParams.get('ongoing_only')),
    boardMode: readBoardMode(searchParams.get('board_mode')),
  };
}

export function buildWorkflowsPageSearchParams(
  currentState: WorkflowsPageState,
  patch: Partial<WorkflowsPageState>,
): URLSearchParams {
  const nextState = {
    ...currentState,
    ...patch,
  };
  const next = new URLSearchParams();

  if (nextState.mode !== DEFAULT_STATE.mode) {
    next.set('mode', nextState.mode);
  }
  if (nextState.workflowId) {
    void nextState.workflowId;
  }
  if (nextState.workItemId) {
    next.set('work_item_id', nextState.workItemId);
  }
  if (nextState.tab) {
    next.set('tab', nextState.tab);
  }
  if (nextState.search.trim().length > 0) {
    next.set('search', nextState.search.trim());
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

export function buildWorkflowsPageHref(
  patch: Partial<WorkflowsPageState> = {},
  currentState: WorkflowsPageState = DEFAULT_STATE,
): string {
  const nextState = {
    ...currentState,
    ...patch,
  };
  const searchParams = buildWorkflowsPageSearchParams(nextState, {});
  const rendered = searchParams.toString();
  const basePath = nextState.workflowId
    ? `/workflows/${encodeURIComponent(nextState.workflowId)}`
    : '/workflows';
  return rendered.length > 0 ? `${basePath}?${rendered}` : basePath;
}

export function buildWorkflowsLaunchHref(input: {
  playbookId?: string | null;
} = {}): string {
  const searchParams = new URLSearchParams();
  searchParams.set('launch', '1');
  if (input.playbookId) {
    searchParams.set('playbook', input.playbookId);
  }
  return `/workflows?${searchParams.toString()}`;
}

export function readWorkflowLaunchRequest(
  searchParams: URLSearchParams,
): WorkflowLaunchRequest {
  if (searchParams.get('launch') !== '1') {
    return {
      isRequested: false,
      playbookId: null,
    };
  }
  return {
    isRequested: true,
    playbookId: readOptionalValue(searchParams.get('playbook')),
  };
}

export function resolveWorkflowTabScope(
  _activeTab: WorkflowWorkbenchTab | null,
  workItemId: string | null,
): 'workflow' | 'selected_work_item' {
  if (workItemId) {
    return 'selected_work_item';
  }
  return 'workflow';
}

function readMode(value: string | null): WorkflowPageMode {
  return value === 'recent' || value === 'history' ? 'recent' : DEFAULT_STATE.mode;
}

function readWorkflowIdFromPath(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] !== 'workflows' || !segments[1]) {
    return null;
  }
  return readOptionalValue(decodeURIComponent(segments[1]));
}

function readTab(value: string | null): WorkflowWorkbenchTab | null {
  switch (value) {
    case 'details':
    case 'needs_action':
    case 'live_console':
    case 'deliverables':
      return value;
    case 'history':
      return 'live_console';
    case 'steering':
      return 'details';
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
