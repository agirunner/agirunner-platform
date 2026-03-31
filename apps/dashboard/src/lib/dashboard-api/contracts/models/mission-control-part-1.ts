import type { DashboardMissionControlArtifactLocation, DashboardWorkflowBoardResponse } from '../models.js';
export type DashboardMissionControlWorkflowPosture =
  | 'needs_decision'
  | 'needs_intervention'
  | 'recoverable_needs_steering'
  | 'progressing'
  | 'waiting_by_design'
  | 'cancelling'
  | 'paused'
  | 'terminal_failed'
  | 'completed'
  | 'cancelled';

export type DashboardMissionControlAttentionLane =
  | 'needs_decision'
  | 'needs_intervention'
  | 'watchlist';

export type DashboardMissionControlPulseTone =
  | 'progressing'
  | 'waiting'
  | 'warning'
  | 'critical'
  | 'settled';

export interface DashboardMissionControlReadModelVersion {
  generatedAt: string;
  latestEventId: number | null;
  token: string | null;
}

export interface DashboardMissionControlPulse {
  summary: string;
  tone: DashboardMissionControlPulseTone;
  updatedAt: string | null;
}

export interface DashboardMissionControlAttentionItem {
  id: string;
  lane: DashboardMissionControlAttentionLane;
  title: string;
  workflowId: string;
  summary: string;
}

export type DashboardMissionControlActionKind =
  | 'pause_workflow'
  | 'resume_workflow'
  | 'cancel_workflow'
  | 'add_work_item'
  | 'request_replan'
  | 'spawn_child_workflow'
  | 'redrive_workflow'
  | 'approve_task'
  | 'reject_task'
  | 'request_changes_task'
  | 'retry_task'
  | 'skip_task'
  | 'reassign_task'
  | 'resolve_escalation';

export type DashboardMissionControlActionScope = 'workflow' | 'work_item' | 'task';

export type DashboardMissionControlConfirmationLevel =
  | 'immediate'
  | 'standard_confirm'
  | 'high_impact_confirm';

export interface DashboardMissionControlActionAvailability {
  kind: DashboardMissionControlActionKind;
  scope: DashboardMissionControlActionScope;
  enabled: boolean;
  confirmationLevel: DashboardMissionControlConfirmationLevel;
  stale: boolean;
  disabledReason: string | null;
}

export type DashboardMissionControlOutputStatus =
  | 'draft'
  | 'under_review'
  | 'approved'
  | 'superseded'
  | 'final';

export interface DashboardMissionControlRepositoryLocation {
  kind: 'repository';
  repository: string;
  branch: string | null;
  branchUrl: string | null;
  commitSha: string | null;
  commitUrl: string | null;
  pullRequestUrl: string | null;
}

export interface DashboardMissionControlHostDirectoryLocation {
  kind: 'host_directory';
  path: string;
}

export interface DashboardMissionControlWorkflowDocumentLocation {
  kind: 'workflow_document';
  workflowId: string;
  documentId: string;
  logicalName: string;
  source: 'repository' | 'artifact' | 'external';
  location: string;
  artifactId: string | null;
}

export interface DashboardMissionControlExternalUrlLocation {
  kind: 'external_url';
  url: string;
}

export type DashboardMissionControlOutputLocation =
  | DashboardMissionControlArtifactLocation
  | DashboardMissionControlRepositoryLocation
  | DashboardMissionControlHostDirectoryLocation
  | DashboardMissionControlWorkflowDocumentLocation
  | DashboardMissionControlExternalUrlLocation;

export interface DashboardMissionControlOutputDescriptor {
  id: string;
  title: string;
  summary: string | null;
  status: DashboardMissionControlOutputStatus;
  producedByRole: string | null;
  workItemId: string | null;
  taskId: string | null;
  stageName: string | null;
  primaryLocation: DashboardMissionControlOutputLocation;
  secondaryLocations: DashboardMissionControlOutputLocation[];
}

export interface DashboardMissionControlWorkflowMetrics {
  activeTaskCount: number;
  activeWorkItemCount: number;
  blockedWorkItemCount: number;
  openEscalationCount: number;
  waitingForDecisionCount: number;
  failedTaskCount: number;
  recoverableIssueCount: number;
  lastChangedAt: string | null;
}

export interface DashboardMissionControlWorkflowCard {
  id: string;
  name: string;
  state: string;
  lifecycle: string | null;
  currentStage: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  playbookId: string | null;
  playbookName: string | null;
  posture: DashboardMissionControlWorkflowPosture;
  attentionLane: DashboardMissionControlAttentionLane;
  pulse: DashboardMissionControlPulse;
  outputDescriptors: DashboardMissionControlOutputDescriptor[];
  availableActions: DashboardMissionControlActionAvailability[];
  metrics: DashboardMissionControlWorkflowMetrics;
  version: DashboardMissionControlReadModelVersion;
}

export interface DashboardMissionControlLiveSection {
  id: 'needs_action' | 'at_risk' | 'progressing' | 'waiting' | 'recently_changed';
  title: string;
  count: number;
  workflows: DashboardMissionControlWorkflowCard[];
}

export interface DashboardMissionControlLiveResponse {
  version: DashboardMissionControlReadModelVersion;
  sections: DashboardMissionControlLiveSection[];
  attentionItems: DashboardMissionControlAttentionItem[];
}

export type DashboardMissionControlPacketCategory =
  | 'decision'
  | 'intervention'
  | 'progress'
  | 'output'
  | 'system';

export interface DashboardMissionControlPacket {
  id: string;
  workflowId: string;
  workflowName: string | null;
  posture: DashboardMissionControlWorkflowPosture | null;
  category: DashboardMissionControlPacketCategory;
  title: string;
  summary: string;
  changedAt: string;
  carryover: boolean;
  outputDescriptors: DashboardMissionControlOutputDescriptor[];
}

export interface DashboardMissionControlRecentResponse {
  version: DashboardMissionControlReadModelVersion;
  packets: DashboardMissionControlPacket[];
}

export interface DashboardMissionControlHistoryResponse {
  version: DashboardMissionControlReadModelVersion;
  packets: DashboardMissionControlPacket[];
}

export interface DashboardMissionControlWorkspaceOverview {
  currentOperatorAsk: string | null;
  latestOutput: DashboardMissionControlOutputDescriptor | null;
  inputSummary: {
    parameterCount: number;
    parameterKeys: string[];
    contextKeys: string[];
  };
  relationSummary: Record<string, unknown>;
  riskSummary: {
    blockedWorkItemCount: number;
    openEscalationCount: number;
    failedTaskCount: number;
    recoverableIssueCount: number;
  };
}

export interface DashboardMissionControlWorkspaceResponse {
  version: DashboardMissionControlReadModelVersion;
  workflow: DashboardMissionControlWorkflowCard | null;
  overview: DashboardMissionControlWorkspaceOverview | null;
  board: DashboardWorkflowBoardResponse | null;
  outputs: {
    deliverables: DashboardMissionControlOutputDescriptor[];
    feed: DashboardMissionControlPacket[];
  };
  steering: {
    availableActions: DashboardMissionControlActionAvailability[];
    interventionHistory: DashboardMissionControlPacket[];
  };
  history: {
    packets: DashboardMissionControlPacket[];
  };
}

export type DashboardWorkflowRailMode = 'live' | 'recent' | 'history';

export interface DashboardWorkflowOperationsSnapshot {
  generated_at: string;
  latest_event_id: number | null;
  snapshot_version: string;
}

export interface DashboardWorkflowRailRow {
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

export interface DashboardWorkflowRailPacket extends DashboardWorkflowOperationsSnapshot {
  mode: DashboardWorkflowRailMode;
  rows: DashboardWorkflowRailRow[];
  ongoing_rows: DashboardWorkflowRailRow[];
  selected_workflow_id: string | null;
  visible_count?: number;
  total_count?: number;
  next_cursor: string | null;
}

export interface DashboardWorkflowNeedsActionItem {
  action_id: string;
  action_kind: string;
  label: string;
  summary: string;
  details?: DashboardWorkflowNeedsActionDetail[];
  work_item_id?: string | null;
  task_id?: string | null;
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
  responses: DashboardWorkflowNeedsActionResponseAction[];
}

export interface DashboardWorkflowNeedsActionScopeSummary {
  workflow_total_count: number;
  selected_scope_total_count: number;
  scoped_away_workflow_count: number;
}

export interface DashboardWorkflowNeedsActionDetail {
  label: string;
  value: string;
}

export interface DashboardWorkflowNeedsActionResponseAction {
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

export interface DashboardWorkflowNeedsActionPacket {
  items: DashboardWorkflowNeedsActionItem[];
  total_count: number;
  default_sort: 'priority_desc';
  scope_summary?: DashboardWorkflowNeedsActionScopeSummary;
}

export interface DashboardWorkflowLiveConsoleItem {
  item_id: string;
  item_kind:
    | 'milestone_brief'
    | 'operator_update'
    | 'platform_notice'
    | 'execution_turn'
    | 'steering_message';
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

export interface DashboardWorkflowLiveConsolePacket extends DashboardWorkflowOperationsSnapshot {
  items: DashboardWorkflowLiveConsoleItem[];
  total_count?: number;
  counts?: {
    all?: number;
    turn_updates?: number;
    briefs?: number;
    steering?: number;
  };
  next_cursor: string | null;
  live_visibility_mode?: 'standard' | 'enhanced';
  scope_filtered?: boolean;
}

export interface DashboardWorkflowHistoryGroup {
  group_id: string;
  label: string;
  anchor_at: string;
  item_ids: string[];
}

export interface DashboardWorkflowHistoryItem {
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

export interface DashboardWorkflowHistoryPacket extends DashboardWorkflowOperationsSnapshot {
  groups: DashboardWorkflowHistoryGroup[];
  items: DashboardWorkflowHistoryItem[];
  filters: {
    available: string[];
    active: string[];
  };
  next_cursor: string | null;
}
