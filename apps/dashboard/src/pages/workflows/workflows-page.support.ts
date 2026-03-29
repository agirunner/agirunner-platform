import type { DashboardWorkflowWorkspacePacket } from '../../lib/api.js';

export type WorkflowPageMode = 'live' | 'recent';
export type WorkflowBoardLens = 'work_items' | 'tasks';
export type WorkflowWorkbenchTab =
  | 'details'
  | 'needs_action'
  | 'steering'
  | 'live_console'
  | 'history'
  | 'deliverables';
export type WorkflowBoardMode = 'active' | 'active_recent_complete' | 'all';
export type WorkflowTabScope = 'workflow' | 'selected_work_item' | 'selected_task';

export interface RequestedWorkspaceScope {
  workflowId: string | null;
  scopeKind: WorkflowTabScope;
  workItemId: string | null;
  taskId: string | null;
}

export interface WorkflowWorkbenchScopeDescriptor {
  scopeKind: WorkflowTabScope;
  title: 'Workflow' | 'Work item' | 'Task';
  subject: 'workflow' | 'work item' | 'task';
  name: string;
  banner: string;
}

export interface WorkflowsPageState {
  mode: WorkflowPageMode;
  workflowId: string | null;
  workItemId: string | null;
  taskId: string | null;
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
  taskId: null,
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
    taskId:
      readOptionalValue(searchParams.get('task_id')) ??
      readOptionalValue(searchParams.get('task')),
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
  if (nextState.taskId) {
    next.set('task_id', nextState.taskId);
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

export function resolveWorkflowTabScope(
  _activeTab: WorkflowWorkbenchTab | null,
  workItemId: string | null,
  taskId: string | null,
): WorkflowTabScope {
  if (taskId) {
    return 'selected_task';
  }
  if (workItemId) {
    return 'selected_work_item';
  }
  return 'workflow';
}

export function resolveBoardSelectionForLens(
  boardLens: WorkflowBoardLens,
  selection: {
    workItemId: string | null;
    taskId: string | null;
  },
): {
  workItemId: string | null;
  taskId: string | null;
} {
  if (boardLens === 'work_items') {
    return {
      workItemId: selection.workItemId,
      taskId: null,
    };
  }
  return selection;
}

export function describeWorkflowWorkbenchScope(input: {
  scopeKind: WorkflowTabScope;
  workflowName: string | null;
  workItemId: string | null;
  workItemTitle: string | null;
  taskId: string | null;
  taskTitle: string | null;
}): WorkflowWorkbenchScopeDescriptor {
  if (input.scopeKind === 'selected_task') {
    const name = input.taskTitle ?? input.taskId ?? 'Selected task';
    return {
      scopeKind: input.scopeKind,
      title: 'Task',
      subject: 'task',
      name,
      banner: `Task: ${name}`,
    };
  }
  if (input.scopeKind === 'selected_work_item') {
    const name = input.workItemTitle ?? input.workItemId ?? 'Selected work item';
    return {
      scopeKind: input.scopeKind,
      title: 'Work item',
      subject: 'work item',
      name,
      banner: `Work item: ${name}`,
    };
  }
  const name = input.workflowName ?? 'Workflow';
  return {
    scopeKind: 'workflow',
    title: 'Workflow',
    subject: 'workflow',
    name,
    banner: `Workflow: ${name}`,
  };
}

export function capitalizeWorkflowWorkbenchScopeSubject(
  subject: WorkflowWorkbenchScopeDescriptor['subject'],
): WorkflowWorkbenchScopeDescriptor['title'] {
  if (subject === 'task') {
    return 'Task';
  }
  if (subject === 'work item') {
    return 'Work item';
  }
  return 'Workflow';
}

export function resolveSelectedWorkflowId(input: {
  currentWorkflowId: string | null;
  rows: Array<{ workflow_id: string }>;
  selectedWorkflowId: string | null;
  storedWorkflowId: string | null;
}): string | null {
  if (input.currentWorkflowId && hasWorkflowRow(input.rows, input.currentWorkflowId)) {
    return input.currentWorkflowId;
  }
  if (input.storedWorkflowId && hasWorkflowRow(input.rows, input.storedWorkflowId)) {
    return input.storedWorkflowId;
  }
  return input.selectedWorkflowId ?? input.rows[0]?.workflow_id ?? null;
}

export function resolveWorkspacePlaceholderData(
  previous: DashboardWorkflowWorkspacePacket | undefined,
  request: RequestedWorkspaceScope,
): DashboardWorkflowWorkspacePacket | undefined {
  if (!previous || !request.workflowId || previous.workflow?.id !== request.workflowId) {
    return undefined;
  }
  if (workspacePacketMatchesScope(previous, request)) {
    return previous;
  }
  return buildScopedWorkspacePlaceholder(previous, request);
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

export function workspacePacketMatchesScope(
  packet: DashboardWorkflowWorkspacePacket,
  request: RequestedWorkspaceScope,
): boolean {
  return (
    packet.selected_scope.scope_kind === request.scopeKind &&
    packet.selected_scope.work_item_id === request.workItemId &&
    packet.selected_scope.task_id === request.taskId &&
    packet.bottom_tabs.current_scope_kind === request.scopeKind &&
    packet.bottom_tabs.current_work_item_id === request.workItemId &&
    packet.bottom_tabs.current_task_id === request.taskId
  );
}

function buildScopedWorkspacePlaceholder(
  previous: DashboardWorkflowWorkspacePacket,
  request: RequestedWorkspaceScope,
): DashboardWorkflowWorkspacePacket {
  return {
    ...previous,
    selected_scope: {
      scope_kind: request.scopeKind,
      work_item_id: request.workItemId,
      task_id: request.taskId,
    },
    bottom_tabs: {
      ...previous.bottom_tabs,
      current_scope_kind: request.scopeKind,
      current_work_item_id: request.workItemId,
      current_task_id: request.taskId,
      counts: buildEmptyBottomTabCounts(),
    },
    steering: {
      ...previous.steering,
      recent_interventions: [],
      session: {
        session_id: null,
        status: 'idle',
        messages: [],
      },
      steering_state: {
        ...previous.steering.steering_state,
        mode: resolveSteeringScopeMode(request),
        active_session_id: null,
        last_summary: null,
      },
    },
    live_console: {
      ...previous.live_console,
      total_count: 0,
      next_cursor: null,
      items: [],
    },
    history: {
      ...previous.history,
      groups: [],
      items: [],
      next_cursor: null,
    },
    deliverables: {
      ...previous.deliverables,
      final_deliverables: [],
      in_progress_deliverables: [],
      working_handoffs: [],
      inputs_and_provenance: {
        launch_packet: null,
        supplemental_packets: [],
        intervention_attachments: [],
        redrive_packet: null,
      },
      next_cursor: null,
    },
  };
}

function buildEmptyBottomTabCounts() {
  return {
    details: 0,
    needs_action: 0,
    steering: 0,
    live_console_activity: 0,
    history: 0,
    deliverables: 0,
  };
}

function resolveSteeringScopeMode(
  request: RequestedWorkspaceScope,
): DashboardWorkflowWorkspacePacket['steering']['steering_state']['mode'] {
  if (request.taskId) {
    return 'selected_task';
  }
  if (request.workItemId) {
    return 'selected_work_item';
  }
  return 'workflow_scoped';
}

function hasWorkflowRow(
  rows: Array<{ workflow_id: string }>,
  workflowId: string,
): boolean {
  return rows.some((row) => row.workflow_id === workflowId);
}
