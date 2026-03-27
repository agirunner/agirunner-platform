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
  target_kind: 'workflow' | 'work_item' | 'task';
  target_id: string;
  requires_confirmation: boolean;
}

export interface WorkflowNeedsActionPacket {
  items: WorkflowNeedsActionItem[];
}

export interface WorkflowLiveConsoleItem {
  item_id: string;
  item_kind: 'milestone_brief' | 'operator_update' | 'platform_notice';
  headline: string;
  summary: string;
  created_at: string;
  linked_target_ids: string[];
}

export interface WorkflowLiveConsolePacket extends WorkflowOperationsSnapshot {
  items: WorkflowLiveConsoleItem[];
  next_cursor: string | null;
}

export interface WorkflowHistoryGroup {
  group_id: string;
  label: string;
  anchor_at: string;
  item_ids: string[];
}

export interface WorkflowHistoryItem {
  item_id: string;
  item_kind: 'milestone_brief' | 'intervention' | 'input' | 'deliverable' | 'redrive';
  headline: string;
  summary: string;
  created_at: string;
  linked_target_ids: string[];
}

export interface WorkflowHistoryPacket extends WorkflowOperationsSnapshot {
  groups: WorkflowHistoryGroup[];
  items: WorkflowHistoryItem[];
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
  default_tab: 'needs_action' | 'steering' | 'live_console' | 'history' | 'deliverables';
  current_scope_kind: 'workflow' | 'selected_work_item';
  current_work_item_id: string | null;
  counts: {
    needs_action: number;
    steering: number;
    live_console: number;
    history: number;
    deliverables: number;
  };
}

export interface WorkflowWorkspacePacket extends WorkflowOperationsSnapshot {
  workflow_id: string;
  sticky_strip: WorkflowStickyStrip | null;
  board: Record<string, unknown> | null;
  bottom_tabs: WorkflowBottomTabsPacket;
  needs_action: WorkflowNeedsActionPacket;
  steering_panel: Record<string, unknown>;
  live_console: WorkflowLiveConsolePacket;
  history_timeline: WorkflowHistoryPacket;
  deliverables_panel: WorkflowDeliverablesPacket;
  redrive_lineage: Record<string, unknown> | null;
  workflow: Record<string, unknown> | null;
  overview: Record<string, unknown> | null;
  outputs: Record<string, unknown>;
  steering: Record<string, unknown>;
  history: Record<string, unknown>;
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
