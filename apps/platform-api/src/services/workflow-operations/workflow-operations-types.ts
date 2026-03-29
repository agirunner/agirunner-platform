export type WorkflowRailMode = 'live' | 'recent' | 'history';

export interface WorkflowOperationsSnapshot {
  generated_at: string;
  latest_event_id: number | null;
  snapshot_version: string;
}

export interface WorkflowRailRow {
  workflow_id: string;
  name: string;
  state: string | null;
  lifecycle: string | null;
  current_stage: string | null;
  workspace_name: string | null;
  playbook_name: string | null;
  posture: string | null;
  live_summary: string;
  last_changed_at: string | null;
  needs_action: boolean;
  counts: {
    active_task_count: number;
    active_work_item_count: number;
    blocked_work_item_count: number;
    open_escalation_count: number;
    waiting_for_decision_count: number;
    failed_task_count: number;
  };
}

export interface WorkflowRailPacket extends WorkflowOperationsSnapshot {
  mode: WorkflowRailMode;
  rows: WorkflowRailRow[];
  ongoing_rows: WorkflowRailRow[];
  selected_workflow_id: string | null;
  next_cursor: string | null;
}

export interface WorkflowNeedsActionItem {
  action_id: string;
  action_kind: string;
  label: string;
  summary: string;
  details?: WorkflowNeedsActionDetail[];
  target: {
    target_kind: 'workflow' | 'work_item' | 'task';
    target_id: string;
  };
  priority: 'high' | 'medium' | 'low';
  requires_confirmation: boolean;
  submission: {
    route_kind: 'workflow_intervention' | 'workflow_mutation' | 'task_mutation';
    method: 'POST';
  };
  responses: WorkflowNeedsActionResponseAction[];
}

export interface WorkflowNeedsActionDetail {
  label: string;
  value: string;
}

export interface WorkflowNeedsActionResponseAction {
  action_id: string;
  kind: string;
  label: string;
  work_item_id?: string | null;
  target: {
    target_kind: 'workflow' | 'work_item' | 'task' | 'gate';
    target_id: string;
  };
  requires_confirmation: boolean;
  prompt_kind: 'none' | 'feedback' | 'instructions';
}

export interface WorkflowNeedsActionPacket {
  items: WorkflowNeedsActionItem[];
  total_count: number;
  default_sort: 'priority_desc';
}

export interface WorkflowLiveConsoleItem {
  item_id: string;
  item_kind: 'milestone_brief' | 'operator_update' | 'platform_notice' | 'execution_turn';
  source_kind: string;
  source_label: string;
  headline: string;
  summary: string;
  created_at: string;
  work_item_id: string | null;
  task_id: string | null;
  linked_target_ids: string[];
  scope_binding?: 'record' | 'structured_target' | 'execution_context';
}

export interface WorkflowLiveConsolePacket extends WorkflowOperationsSnapshot {
  items: WorkflowLiveConsoleItem[];
  total_count: number;
  next_cursor: string | null;
  live_visibility_mode: 'standard' | 'enhanced';
}

export interface WorkflowHistoryGroup {
  group_id: string;
  label: string;
  anchor_at: string;
  item_ids: string[];
}

export interface WorkflowHistoryItem {
  item_id: string;
  item_kind:
    | 'milestone_brief'
    | 'operator_update'
    | 'platform_notice'
    | 'lifecycle_event'
    | 'intervention'
    | 'input'
    | 'deliverable'
    | 'redrive';
  source_kind: string;
  source_label: string;
  headline: string;
  summary: string;
  created_at: string;
  work_item_id: string | null;
  task_id: string | null;
  linked_target_ids: string[];
}

export interface WorkflowHistoryPacket extends WorkflowOperationsSnapshot {
  groups: WorkflowHistoryGroup[];
  items: WorkflowHistoryItem[];
  total_count: number;
  filters: {
    available: string[];
    active: string[];
  };
  next_cursor: string | null;
}

export interface WorkflowDeliverablesPacket {
  final_deliverables: unknown[];
  in_progress_deliverables: unknown[];
  working_handoffs: unknown[];
  inputs_and_provenance: {
    launch_packet: unknown | null;
    supplemental_packets: unknown[];
    intervention_attachments: unknown[];
    redrive_packet: unknown | null;
  };
  next_cursor: string | null;
}

export interface WorkflowSteeringPacket {
  quick_actions: unknown[];
  decision_actions: unknown[];
  steering_state: {
    mode: 'workflow_scoped' | 'selected_work_item' | 'selected_task';
    can_accept_request: boolean;
    active_session_id: string | null;
    last_summary: string | null;
  };
  recent_interventions: unknown[];
  session: {
    session_id: string | null;
    status: string;
    messages: unknown[];
  } | null;
}

export interface WorkflowStickyStrip {
  workflow_id: string;
  workflow_name: string;
  posture: string | null;
  summary: string;
  approvals_count: number;
  escalations_count: number;
  blocked_work_item_count: number;
  active_task_count: number;
  active_work_item_count: number;
  steering_available: boolean;
}

export interface WorkflowBottomTabsPacket {
  default_tab: 'details' | 'needs_action' | 'steering' | 'live_console' | 'history' | 'deliverables';
  current_scope_kind: 'workflow' | 'selected_work_item' | 'selected_task';
  current_work_item_id: string | null;
  current_task_id: string | null;
  counts: {
    details: number;
    needs_action: number;
    steering: number;
    live_console_activity: number;
    history: number;
    deliverables: number;
  };
}

export interface WorkflowWorkspacePacket extends WorkflowOperationsSnapshot {
  workflow_id: string;
  workflow: import('./mission-control-types.js').MissionControlWorkflowCard | null;
  selected_scope: {
    scope_kind: 'workflow' | 'selected_work_item' | 'selected_task';
    work_item_id: string | null;
    task_id: string | null;
  };
  sticky_strip: WorkflowStickyStrip | null;
  board: Record<string, unknown> | null;
  bottom_tabs: WorkflowBottomTabsPacket;
  needs_action: WorkflowNeedsActionPacket;
  steering: WorkflowSteeringPacket;
  live_console: WorkflowLiveConsolePacket;
  history: WorkflowHistoryPacket;
  deliverables: WorkflowDeliverablesPacket;
  redrive_lineage: Record<string, unknown> | null;
}

export interface WorkflowOperationsStreamEvent {
  event_type: string;
  cursor: string;
  snapshot_version: string;
  workflow_id: string | null;
  payload: unknown;
}

export interface WorkflowOperationsStreamBatch extends WorkflowOperationsSnapshot {
  cursor: string;
  surface_cursors?: {
    live_console_head: string | null;
    history_head: string | null;
    deliverables_head: string | null;
  };
  events: WorkflowOperationsStreamEvent[];
}

export function buildWorkflowOperationsSnapshotVersion(latestEventId: number | null): string {
  return `workflow-operations:${latestEventId ?? 0}`;
}

export function parseWorkflowOperationsCursor(cursor: string): number | null {
  const parts = cursor.split(':');
  if (parts.length !== 2 || parts[0] !== 'workflow-operations') {
    return null;
  }
  const parsed = Number(parts[1]);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}
