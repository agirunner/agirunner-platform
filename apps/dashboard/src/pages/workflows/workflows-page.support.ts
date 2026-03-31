import type { DashboardWorkflowWorkspacePacket } from '../../lib/api.js';
import { stringifyWorkflowLaunchParameterDrafts } from './workflow-launch-dialog.support.js';
export {
  buildWorkflowsLaunchHref,
  buildWorkflowsPageHref,
  buildWorkflowsPageSearchParams,
  readWorkflowLaunchRequest,
  readWorkflowsPageState,
  resolveWorkflowTabScope,
  type WorkflowBoardMode,
  type WorkflowLaunchRequest,
  type WorkflowPageMode,
  type WorkflowsPageState,
  type WorkflowTabScope,
  type WorkflowWorkbenchTab,
} from './workflows-page.routes.js';
import type { WorkflowTabScope } from './workflows-page.routes.js';

export interface RequestedWorkspaceScope {
  workflowId: string | null;
  scopeKind: WorkflowTabScope;
  workItemId: string | null;
}

export interface WorkflowWorkbenchScopeDescriptor {
  scopeKind: WorkflowTabScope;
  title: 'Workflow' | 'Work item';
  subject: 'workflow' | 'work item';
  name: string;
  banner: string;
}

export interface WorkflowRepeatLaunchSeed {
  playbookId: string | null;
  workspaceId: string | null;
  workflowName: string | null;
  parameterDrafts: Record<string, string>;
}

export function resolveHeaderAddWorkTargetWorkItemId(input: {
  scopeKind: WorkflowTabScope;
  workItemId: string | null;
}): string | null {
  if (input.scopeKind !== 'selected_work_item') {
    return null;
  }
  return input.workItemId;
}

export function describeHeaderAddWorkLabel(input: {
  scopeKind: WorkflowTabScope;
  lifecycle: string | null | undefined;
}): 'Add Intake' | 'Add Work' | 'Modify Work' {
  if (input.scopeKind === 'selected_work_item') {
    return 'Modify Work';
  }
  return input.lifecycle === 'ongoing' ? 'Add Intake' : 'Add Work';
}

export function buildRepeatWorkflowLaunchSeed(input: {
  workflowState: string | null | undefined;
  playbookId: string | null | undefined;
  workspaceId: string | null | undefined;
  workItemTitle: string | null | undefined;
  workflowParameters: Record<string, unknown> | null | undefined;
}): WorkflowRepeatLaunchSeed | null {
  if (!isTerminalWorkflowState(input.workflowState)) {
    return null;
  }

  return {
    playbookId: input.playbookId ?? null,
    workspaceId: input.workspaceId ?? null,
    workflowName: input.workItemTitle ?? null,
    parameterDrafts: stringifyWorkflowLaunchParameterDrafts(input.workflowParameters),
  };
}

export function describeWorkflowWorkbenchScope(input: {
  scopeKind: WorkflowTabScope;
  workflowName: string | null;
  workItemId: string | null;
  workItemTitle: string | null;
}): WorkflowWorkbenchScopeDescriptor {
  if (input.scopeKind !== 'workflow' && (input.workItemTitle ?? input.workItemId)) {
    const name = input.workItemTitle ?? input.workItemId ?? 'Selected work item';
    return {
      scopeKind: 'selected_work_item',
      title: 'Work item',
      subject: 'work item',
      name,
      banner: `Work item · ${name}`,
    };
  }
  const name = input.workflowName ?? 'Workflow';
  return {
    scopeKind: 'workflow',
    title: 'Workflow',
    subject: 'workflow',
    name,
    banner: `Workflow · ${name}`,
  };
}

export function capitalizeWorkflowWorkbenchScopeSubject(
  subject: WorkflowWorkbenchScopeDescriptor['subject'],
): WorkflowWorkbenchScopeDescriptor['title'] {
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

function isTerminalWorkflowState(state: string | null | undefined): boolean {
  return state === 'completed' || state === 'cancelled' || state === 'failed';
}

export function workspacePacketMatchesScope(
  packet: DashboardWorkflowWorkspacePacket,
  request: RequestedWorkspaceScope,
): boolean {
  return (
    packet.selected_scope.scope_kind === request.scopeKind &&
    packet.selected_scope.work_item_id === request.workItemId &&
    packet.selected_scope.task_id === null &&
    packet.bottom_tabs.current_scope_kind === request.scopeKind &&
    packet.bottom_tabs.current_work_item_id === request.workItemId &&
    packet.bottom_tabs.current_task_id === null
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
      task_id: null,
    },
    bottom_tabs: {
      ...previous.bottom_tabs,
      current_scope_kind: request.scopeKind,
      current_work_item_id: request.workItemId,
      current_task_id: null,
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
