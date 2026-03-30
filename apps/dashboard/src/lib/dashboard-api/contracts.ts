import {
  PlatformApiClient,
  type ApiListResponse,
  type Task,
  type TaskState,
  type WorkflowState,
} from '@agirunner/sdk';

export interface DashboardApiOptions {
  baseUrl?: string;
  client?: PlatformApiClient;
  fetcher?: typeof fetch;
}

export interface NamedRecord {
  id: string;
  name?: string;
  title?: string;
  state?: string;
  status?: string;
}

export type DashboardTaskState = TaskState;
export type DashboardWorkflowState = WorkflowState;

export interface DashboardAgentRecord {
  id: string;
  worker_id?: string | null;
  name?: string | null;
  routing_tags?: string[] | null;
  status?: string | null;
  current_task_id?: string | null;
  heartbeat_interval_seconds?: number | null;
  last_heartbeat_at?: string | null;
  metadata?: Record<string, unknown> | null;
  registered_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface DashboardSearchResult {
  type: 'workflow' | 'task' | 'worker' | 'agent' | 'workspace' | 'playbook';
  id: string;
  label: string;
  subtitle: string;
  href: string;
}

export interface DashboardPlaybookRecord {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  outcome: string;
  lifecycle: 'planned' | 'ongoing';
  version: number;
  is_active?: boolean;
  definition: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface DashboardDeleteImpactSummary {
  workflows: number;
  active_workflows: number;
  tasks: number;
  active_tasks: number;
  work_items: number;
}

export interface DashboardPlaybookDeleteImpact {
  revision: DashboardDeleteImpactSummary;
  family: DashboardDeleteImpactSummary & { revisions: number };
}

export interface DashboardEventRecord {
  id: string;
  type: string;
  entity_type: string;
  entity_id: string;
  actor_type: string;
  actor_id?: string | null;
  data?: Record<string, unknown>;
  created_at: string;
}

export interface DashboardCursorPageMeta {
  has_more: boolean;
  next_after: string | null;
}

export interface DashboardEventPage {
  data: DashboardEventRecord[];
  meta: DashboardCursorPageMeta;
}

export interface DashboardApiKeyRecord {
  id: string;
  scope: string;
  owner_type: string;
  owner_id: string | null;
  label: string | null;
  key_prefix: string;
  last_used_at: string | null;
  expires_at: string | null;
  is_revoked: boolean;
  revoked_at?: string | null;
  created_at: string;
}

export interface DashboardRoleModelOverride {
  provider: string;
  model: string;
  reasoning_config?: Record<string, unknown> | null;
}

export interface DashboardWorkspaceCredentialPosture {
  git_token?: string | null;
  git_token_configured?: boolean;
  git_ssh_private_key?: string | null;
  git_ssh_private_key_configured?: boolean;
  git_ssh_known_hosts?: string | null;
  git_ssh_known_hosts_configured?: boolean;
  webhook_secret?: string | null;
  webhook_secret_configured?: boolean;
}

export interface DashboardWorkspaceArtifactFileRecord {
  id: string;
  workspace_id: string;
  key: string;
  description?: string | null;
  file_name: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
  download_url: string;
}

export interface DashboardWorkspaceArtifactFileUploadInput {
  key?: string;
  description?: string;
  file_name: string;
  content_base64: string;
  content_type?: string;
}

export interface DashboardWorkspaceCredentialInput {
  git_token?: string | null;
  git_token_configured?: boolean;
  git_ssh_private_key?: string | null;
  git_ssh_private_key_configured?: boolean;
  git_ssh_known_hosts?: string | null;
  git_ssh_known_hosts_configured?: boolean;
  webhook_secret?: string | null;
  webhook_secret_configured?: boolean;
}

export type DashboardWorkspaceStorageType = 'git_remote' | 'host_directory' | 'workspace_artifacts';

export interface DashboardWorkspaceStorageRecord extends Record<string, unknown> {
  repository_url?: string | null;
  default_branch?: string | null;
  git_user_name?: string | null;
  git_user_email?: string | null;
  host_path?: string | null;
  read_only?: boolean | null;
}

export type DashboardWorkspaceSettingsRecord = Record<string, unknown> & {
  workspace_storage_type?: DashboardWorkspaceStorageType | null;
  workspace_storage?: DashboardWorkspaceStorageRecord;
  default_branch?: string | null;
  git_user_name?: string | null;
  git_user_email?: string | null;
  credentials?: DashboardWorkspaceCredentialPosture;
  workspace_brief?: string | null;
};

export type DashboardWorkspaceSettingsInput = Record<string, unknown> & {
  workspace_storage_type?: DashboardWorkspaceStorageType | null;
  workspace_storage?: DashboardWorkspaceStorageRecord;
  default_branch?: string | null;
  git_user_name?: string | null;
  git_user_email?: string | null;
  credentials?: DashboardWorkspaceCredentialInput;
  workspace_brief?: string | null;
};

export interface DashboardWorkspaceCreateInput {
  name: string;
  slug: string;
  description?: string;
  repository_url?: string;
  settings?: DashboardWorkspaceSettingsInput;
}

export interface DashboardWorkspacePatchInput {
  name?: string;
  slug?: string;
  description?: string;
  repository_url?: string;
  settings?: DashboardWorkspaceSettingsInput;
  is_active?: boolean;
}

export interface DashboardWorkspaceGitAccessVerifyInput {
  repository_url: string;
  default_branch?: string;
  git_token_mode: 'preserve' | 'replace' | 'clear';
  git_token?: string;
}

export interface DashboardWorkspaceGitAccessVerifyResult {
  ok: true;
  repository_url: string;
  default_branch: string | null;
  branch_verified: boolean;
}

export interface DashboardWorkflowBudgetInput {
  token_budget?: number;
  cost_cap_usd?: number;
  max_duration_minutes?: number;
}

export interface DashboardWorkflowBudgetRecord {
  tokens_used: number;
  tokens_limit: number | null;
  cost_usd: number;
  cost_limit_usd: number | null;
  elapsed_minutes: number;
  duration_limit_minutes: number | null;
  task_count: number;
  orchestrator_activations: number;
  tokens_remaining: number | null;
  cost_remaining_usd: number | null;
  time_remaining_minutes: number | null;
  warning_dimensions: string[];
  exceeded_dimensions: string[];
  warning_threshold_ratio: number;
}

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

export interface DashboardMissionControlArtifactLocation {
  kind: 'artifact';
  artifactId: string;
  taskId: string;
  logicalPath: string;
  previewPath: string | null;
  downloadPath: string;
  contentType: string | null;
}

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

export interface DashboardWorkflowBriefItem {
  brief_id: string;
  workflow_id: string;
  work_item_id: string | null;
  task_id: string | null;
  request_id: string;
  execution_context_id: string;
  brief_kind: string;
  brief_scope: string;
  source_kind: string;
  source_label: string;
  source_role_name: string | null;
  headline: string;
  summary: string;
  llm_turn_count: number | null;
  status_kind: string;
  short_brief: Record<string, unknown>;
  detailed_brief_json: Record<string, unknown>;
  linked_target_ids: string[];
  sequence_number: number;
  related_artifact_ids: string[];
  related_output_descriptor_ids: string[];
  related_intervention_ids: string[];
  canonical_workflow_brief_id: string | null;
  created_by_type: string;
  created_by_id: string;
  created_at: string;
  updated_at: string;
}

export interface DashboardWorkflowBriefsPacket extends DashboardWorkflowOperationsSnapshot {
  items: DashboardWorkflowBriefItem[];
  total_count: number;
  next_cursor: string | null;
}

export interface DashboardWorkflowDeliverableTarget {
  target_kind: string;
  label: string;
  url: string;
  path?: string | null;
  repo_ref?: string | null;
  artifact_id?: string | null;
  size_bytes?: number | null;
}

export interface DashboardWorkflowDeliverableRecord {
  descriptor_id: string;
  workflow_id: string;
  work_item_id: string | null;
  descriptor_kind: string;
  delivery_stage: 'in_progress' | 'final' | string;
  title: string;
  state: 'draft' | 'under_review' | 'approved' | 'superseded' | 'final' | string;
  summary_brief: string | null;
  preview_capabilities: Record<string, unknown>;
  primary_target: DashboardWorkflowDeliverableTarget;
  secondary_targets: DashboardWorkflowDeliverableTarget[];
  content_preview: Record<string, unknown>;
  source_brief_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DashboardWorkflowOperatorBriefRecord {
  id: string;
  workflow_id: string;
  work_item_id: string | null;
  task_id: string | null;
  request_id: string;
  execution_context_id: string;
  brief_kind: string;
  brief_scope: string;
  source_kind: string;
  source_role_name: string | null;
  status_kind: string;
  short_brief: Record<string, unknown>;
  detailed_brief_json: Record<string, unknown>;
  linked_target_ids: string[];
  sequence_number: number;
  related_artifact_ids: string[];
  related_output_descriptor_ids: string[];
  related_intervention_ids: string[];
  canonical_workflow_brief_id: string | null;
  created_by_type: string;
  created_by_id: string;
  created_at: string;
  updated_at: string;
}

export interface DashboardWorkflowDeliverablesPacket {
  final_deliverables: DashboardWorkflowDeliverableRecord[];
  in_progress_deliverables: DashboardWorkflowDeliverableRecord[];
  working_handoffs: DashboardWorkflowOperatorBriefRecord[];
  inputs_and_provenance: {
    launch_packet: DashboardWorkflowInputPacketRecord | null;
    supplemental_packets: DashboardWorkflowInputPacketRecord[];
    intervention_attachments: DashboardWorkflowInterventionRecord[];
    redrive_packet: DashboardWorkflowInputPacketRecord | null;
  };
  next_cursor: string | null;
}

export interface DashboardWorkflowStickyStrip {
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

export interface DashboardWorkflowBottomTabsPacket {
  default_tab: 'details' | 'needs_action' | 'steering' | 'live_console' | 'history' | 'deliverables';
  current_scope_kind: 'workflow' | 'selected_work_item' | 'selected_task';
  current_work_item_id: string | null;
  current_task_id: string | null;
  counts: {
    details: number;
    needs_action: number;
    steering: number;
    live_console_activity: number;
    briefs?: number;
    history: number;
    deliverables: number;
  };
}

export interface DashboardWorkflowWorkspacePacket extends DashboardWorkflowOperationsSnapshot {
  workflow_id: string;
  workflow: DashboardMissionControlWorkflowCard | null;
  selected_scope: {
    scope_kind: 'workflow' | 'selected_work_item' | 'selected_task';
    work_item_id: string | null;
    task_id: string | null;
  };
  sticky_strip: DashboardWorkflowStickyStrip | null;
  board: DashboardWorkflowBoardResponse | null;
  bottom_tabs: DashboardWorkflowBottomTabsPacket;
  needs_action: DashboardWorkflowNeedsActionPacket;
  steering: {
    quick_actions: DashboardMissionControlActionAvailability[];
    decision_actions: DashboardMissionControlActionAvailability[];
    steering_state: {
      mode: 'workflow_scoped' | 'selected_work_item' | 'selected_task';
      can_accept_request: boolean;
      active_session_id: string | null;
      last_summary: string | null;
    };
    recent_interventions: DashboardWorkflowInterventionRecord[];
    session: {
      session_id: string | null;
      status: string;
      messages: DashboardWorkflowSteeringMessageRecord[];
    };
  };
  live_console: DashboardWorkflowLiveConsolePacket;
  briefs?: DashboardWorkflowBriefsPacket;
  history: DashboardWorkflowHistoryPacket;
  deliverables: DashboardWorkflowDeliverablesPacket;
  redrive_lineage: Record<string, unknown> | null;
}

export interface DashboardWorkflowOperationsStreamEvent {
  event_type: string;
  cursor: string;
  snapshot_version: string;
  workflow_id: string | null;
  payload: unknown;
}

export interface DashboardWorkflowOperationsStreamBatch extends DashboardWorkflowOperationsSnapshot {
  cursor: string;
  events: DashboardWorkflowOperationsStreamEvent[];
}

export interface DashboardWorkflowOperatorFileUploadInput {
  description?: string;
  file_name: string;
  content_base64: string;
  content_type?: string;
}

export interface DashboardWorkflowInputPacketFileRecord {
  id: string;
  file_name: string;
  description: string | null;
  content_type: string;
  size_bytes: number;
  created_at: string;
  download_url: string;
}

export interface DashboardWorkflowInputPacketRecord {
  id: string;
  workflow_id: string;
  work_item_id: string | null;
  packet_kind: string;
  source: string;
  summary: string | null;
  structured_inputs: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_by_type: string;
  created_by_id: string;
  created_at: string;
  updated_at: string;
  files: DashboardWorkflowInputPacketFileRecord[];
}

export interface DashboardWorkflowInputPacketCreateInput {
  packet_kind: string;
  source?: string;
  summary?: string;
  structured_inputs?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  work_item_id?: string;
  files?: DashboardWorkflowOperatorFileUploadInput[];
}

export interface DashboardWorkflowInterventionFileRecord {
  id: string;
  file_name: string;
  description: string | null;
  content_type: string;
  size_bytes: number;
  created_at: string;
  download_url: string;
}

export interface DashboardWorkflowInterventionRecord {
  id: string;
  workflow_id: string;
  work_item_id: string | null;
  task_id: string | null;
  kind: string;
  origin: string;
  status: string;
  summary: string;
  note: string | null;
  structured_action: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_by_type: string;
  created_by_id: string;
  created_at: string;
  updated_at: string;
  files: DashboardWorkflowInterventionFileRecord[];
}

export interface DashboardWorkflowInterventionCreateInput {
  kind: string;
  origin?: string;
  status?: string;
  summary: string;
  note?: string;
  structured_action?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  work_item_id?: string;
  task_id?: string;
  files?: DashboardWorkflowOperatorFileUploadInput[];
}

export interface DashboardWorkflowSteeringSessionRecord {
  id: string;
  workflow_id: string;
  work_item_id?: string | null;
  title: string | null;
  status: string;
  created_by_type: string;
  created_by_id: string;
  created_at: string;
  updated_at: string;
  last_message_at?: string | null;
}

export interface DashboardWorkflowSteeringSessionCreateInput {
  title?: string;
}

export interface DashboardWorkflowSteeringMessageRecord {
  id: string;
  workflow_id: string;
  work_item_id?: string | null;
  steering_session_id: string;
  role?: string;
  content?: string;
  structured_proposal?: Record<string, unknown>;
  intervention_id?: string | null;
  source_kind?: string;
  message_kind?: string;
  headline?: string;
  body?: string | null;
  linked_intervention_id?: string | null;
  linked_input_packet_id?: string | null;
  linked_operator_update_id?: string | null;
  created_by_type: string;
  created_by_id: string;
  created_at: string;
}

export interface DashboardWorkflowSteeringMessageCreateInput {
  content: string;
  structured_proposal?: Record<string, unknown>;
  intervention_id?: string;
}

export interface DashboardWorkflowSteeringRequestInput {
  request_id: string;
  request: string;
  base_snapshot_version?: string;
  work_item_id?: string;
  task_id?: string;
  linked_input_packet_ids?: string[];
  session_id?: string;
}

export interface DashboardWorkflowSteeringRequestResult {
  outcome: 'applied';
  result_kind: 'steering_request_recorded';
  source_workflow_id: string;
  workflow_id: string;
  resulting_work_item_id: string | null;
  input_packet_id: string | null;
  intervention_id: string | null;
  snapshot_version: string | null;
  settings_revision: number | null;
  message: string;
  redrive_lineage: null;
  steering_session_id: string;
  request_message_id: string;
  response_message_id: string | null;
  linked_intervention_ids: string[];
  linked_input_packet_ids: string[];
}

export interface DashboardWorkflowRedriveInput {
  request_id: string;
  name?: string;
  summary?: string;
  steering_instruction?: string;
  parameters?: Record<string, string>;
  structured_inputs?: Record<string, unknown>;
  files?: DashboardWorkflowOperatorFileUploadInput[];
}

export interface DashboardWorkflowRedriveResult {
  source_workflow_id: string;
  attempt_number: number;
  workflow: DashboardWorkflowRecord;
  input_packet: DashboardWorkflowInputPacketRecord | null;
}

export interface DashboardWorkflowSettingsRecord {
  workflow_id: string;
  effective_live_visibility_mode: 'standard' | 'enhanced';
  workflow_live_visibility_mode_override: 'standard' | 'enhanced' | null;
  source: 'agentic_settings' | 'workflow_override';
  revision: number;
  updated_by_operator_id: string | null;
  updated_at: string | null;
}

export interface DashboardWorkflowSettingsPatchInput {
  live_visibility_mode: 'standard' | 'enhanced' | null;
  settings_revision: number;
}

export interface DashboardAgenticSettingsRecord {
  live_visibility_mode_default: 'standard' | 'enhanced';
  prompt_warning_threshold_chars: number;
  scope: 'tenant';
  revision: number;
  updated_by_operator_id: string | null;
  updated_at: string | null;
}

export interface DashboardAgenticSettingsPatchInput {
  live_visibility_mode_default: 'standard' | 'enhanced';
  prompt_warning_threshold_chars: number;
  settings_revision: number;
}

export interface DashboardLlmProviderRecord {
  id: string;
  name: string;
  auth_mode?: string | null;
  credentials_configured?: boolean;
}

export interface DashboardLlmModelRecord {
  id: string;
  model_id: string;
  provider_id?: string | null;
  provider_name?: string | null;
  native_search?: {
    mode: 'openai_web_search' | 'anthropic_web_search_20250305' | 'google_search';
    defaultEnabled: boolean;
  } | null;
  is_enabled?: boolean;
}

export interface DashboardToolTagRecord {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  owner?: 'runtime' | 'task';
  access_scope?: 'specialist_and_orchestrator' | 'orchestrator_only';
  usage_surface?: 'runtime' | 'task_sandbox' | 'provider_capability';
  is_callable?: boolean;
  created_at?: string;
  is_built_in?: boolean;
}

export interface DashboardToolTagCreateInput {
  id: string;
  name: string;
  description?: string;
  category: string;
}

export interface DashboardToolTagUpdateInput {
  name: string;
  description?: string;
  category: string;
}

export interface DashboardRuntimeDefaultRecord {
  id: string;
  config_key: string;
  config_value: string;
  config_type: string;
  description: string | null;
}

export interface DashboardRuntimeDefaultUpsertInput {
  configKey: string;
  configValue: string;
  configType: 'string' | 'number' | 'boolean';
  description: string;
}

export type DashboardExecutionEnvironmentPullPolicy = 'always' | 'if-not-present' | 'never';
export type DashboardExecutionEnvironmentCompatibilityStatus =
  | 'unknown'
  | 'compatible'
  | 'incompatible';
export type DashboardExecutionEnvironmentSupportStatus = 'active' | 'deprecated' | 'blocked';

export interface DashboardExecutionEnvironmentCatalogRecord {
  catalog_key: string;
  catalog_version: number;
  name: string;
  description?: string | null;
  image: string;
  cpu: string;
  memory: string;
  pull_policy: DashboardExecutionEnvironmentPullPolicy;
  bootstrap_commands: string[];
  bootstrap_required_domains: string[];
  declared_metadata: Record<string, unknown>;
  support_status: DashboardExecutionEnvironmentSupportStatus;
  replacement_catalog_key?: string | null;
  replacement_catalog_version?: number | null;
  created_at?: string;
}

export interface DashboardExecutionEnvironmentRecord {
  id: string;
  name: string;
  description?: string | null;
  source_kind: 'catalog' | 'custom';
  catalog_key?: string | null;
  catalog_version?: number | null;
  image: string;
  cpu: string;
  memory: string;
  pull_policy: DashboardExecutionEnvironmentPullPolicy;
  bootstrap_commands: string[];
  bootstrap_required_domains: string[];
  operator_notes?: string | null;
  declared_metadata: Record<string, unknown>;
  verified_metadata: Record<string, unknown>;
  tool_capabilities: Record<string, unknown>;
  compatibility_status: DashboardExecutionEnvironmentCompatibilityStatus;
  compatibility_errors: string[];
  verification_contract_version?: string | null;
  last_verified_at?: string | null;
  is_default: boolean;
  is_archived: boolean;
  is_claimable: boolean;
  support_status?: DashboardExecutionEnvironmentSupportStatus | null;
  usage_count: number;
  agent_hint: string;
  created_at?: string;
  updated_at?: string;
}

export interface DashboardExecutionEnvironmentCreateInput {
  name: string;
  description?: string;
  image: string;
  cpu: string;
  memory: string;
  pullPolicy: DashboardExecutionEnvironmentPullPolicy;
  operatorNotes?: string;
}

export interface DashboardExecutionEnvironmentCreateFromCatalogInput {
  catalogKey: string;
  catalogVersion: number;
  name?: string;
  description?: string;
  operatorNotes?: string;
}

export interface DashboardExecutionEnvironmentUpdateInput {
  name?: string;
  description?: string | null;
  image?: string;
  cpu?: string;
  memory?: string;
  pullPolicy?: DashboardExecutionEnvironmentPullPolicy;
  operatorNotes?: string | null;
}

export type DashboardRemoteMcpAuthMode = 'none' | 'parameterized' | 'oauth';
export type DashboardRemoteMcpTransportPreference = 'auto' | 'streamable_http' | 'http_sse_compat';
export type DashboardRemoteMcpTransport = 'streamable_http' | 'http_sse_compat';
export type DashboardRemoteMcpParameterPlacement =
  | 'path'
  | 'query'
  | 'header'
  | 'cookie'
  | 'initialize_param'
  | 'authorize_request_query'
  | 'device_request_query'
  | 'device_request_header'
  | 'device_request_body_form'
  | 'device_request_body_json'
  | 'token_request_query'
  | 'token_request_header'
  | 'token_request_body_form'
  | 'token_request_body_json';
export type DashboardRemoteMcpOauthGrantType =
  | 'authorization_code'
  | 'device_authorization'
  | 'client_credentials'
  | 'enterprise_managed_authorization';
export type DashboardRemoteMcpOauthClientStrategy =
  | 'auto'
  | 'dynamic_registration'
  | 'client_metadata_document'
  | 'manual_client';
export type DashboardRemoteMcpOauthCallbackMode = 'loopback' | 'hosted_https';
export type DashboardRemoteMcpOauthTokenEndpointAuthMethod =
  | 'none'
  | 'client_secret_post'
  | 'client_secret_basic'
  | 'private_key_jwt';
export type DashboardRemoteMcpOauthParMode = 'disabled' | 'enabled' | 'required';
export type DashboardRemoteMcpOauthJarMode = 'disabled' | 'request_parameter' | 'request_uri';

export interface DashboardRemoteMcpOAuthClientProfileRecord {
  id: string;
  tenant_id?: string;
  name: string;
  slug: string;
  description: string;
  issuer: string | null;
  authorization_endpoint: string | null;
  token_endpoint: string;
  registration_endpoint: string | null;
  device_authorization_endpoint: string | null;
  callback_mode: DashboardRemoteMcpOauthCallbackMode;
  token_endpoint_auth_method: DashboardRemoteMcpOauthTokenEndpointAuthMethod;
  client_id: string;
  client_secret: string | null;
  has_stored_client_secret: boolean;
  default_scopes: string[];
  default_resource_indicators: string[];
  default_audiences: string[];
  linked_server_count: number;
  created_at: string;
  updated_at: string;
}

export interface DashboardRemoteMcpOAuthClientProfileCreateInput {
  name: string;
  description?: string;
  issuer?: string | null;
  authorizationEndpoint?: string | null;
  tokenEndpoint: string;
  registrationEndpoint?: string | null;
  deviceAuthorizationEndpoint?: string | null;
  callbackMode?: DashboardRemoteMcpOauthCallbackMode;
  tokenEndpointAuthMethod?: DashboardRemoteMcpOauthTokenEndpointAuthMethod;
  clientId: string;
  clientSecret?: string | null;
  defaultScopes?: string[];
  defaultResourceIndicators?: string[];
  defaultAudiences?: string[];
}

export interface DashboardRemoteMcpOAuthClientProfileUpdateInput {
  name?: string;
  description?: string;
  issuer?: string | null;
  authorizationEndpoint?: string | null;
  tokenEndpoint?: string;
  registrationEndpoint?: string | null;
  deviceAuthorizationEndpoint?: string | null;
  callbackMode?: DashboardRemoteMcpOauthCallbackMode;
  tokenEndpointAuthMethod?: DashboardRemoteMcpOauthTokenEndpointAuthMethod;
  clientId?: string;
  clientSecret?: string | null;
  defaultScopes?: string[];
  defaultResourceIndicators?: string[];
  defaultAudiences?: string[];
}

export interface DashboardRemoteMcpOauthDefinition {
  grantType?: DashboardRemoteMcpOauthGrantType;
  clientStrategy?: DashboardRemoteMcpOauthClientStrategy;
  callbackMode?: DashboardRemoteMcpOauthCallbackMode;
  clientId?: string | null;
  clientSecret?: string | null;
  tokenEndpointAuthMethod?: DashboardRemoteMcpOauthTokenEndpointAuthMethod;
  authorizationEndpointOverride?: string | null;
  tokenEndpointOverride?: string | null;
  registrationEndpointOverride?: string | null;
  deviceAuthorizationEndpointOverride?: string | null;
  protectedResourceMetadataUrlOverride?: string | null;
  authorizationServerMetadataUrlOverride?: string | null;
  scopes?: string[];
  resourceIndicators?: string[];
  audiences?: string[];
  enterpriseProfile?: Record<string, unknown> | null;
  parMode?: DashboardRemoteMcpOauthParMode;
  jarMode?: DashboardRemoteMcpOauthJarMode;
  privateKeyPem?: string | null;
}

export interface DashboardRemoteMcpServerParameterRecord {
  id: string;
  placement: DashboardRemoteMcpParameterPlacement;
  key: string;
  value_kind: 'static' | 'secret';
  value: string;
  has_stored_secret: boolean;
}

export interface DashboardRemoteMcpServerRecord {
  id: string;
  tenant_id?: string;
  name: string;
  slug: string;
  description: string;
  endpoint_url: string;
  transport_preference?: DashboardRemoteMcpTransportPreference;
  call_timeout_seconds: number;
  auth_mode: DashboardRemoteMcpAuthMode;
  enabled_by_default_for_new_specialists: boolean;
  is_archived: boolean;
  verification_status: 'unknown' | 'verified' | 'failed';
  verification_error: string | null;
  verified_transport: DashboardRemoteMcpTransport | null;
  verified_discovery_strategy?: string | null;
  verified_oauth_strategy?: string | null;
  verified_at: string | null;
  verification_contract_version: string;
  verified_capability_summary?: Record<string, unknown>;
  discovered_tools_snapshot: Record<string, unknown>[];
  discovered_resources_snapshot?: Record<string, unknown>[];
  discovered_prompts_snapshot?: Record<string, unknown>[];
  discovered_tool_count: number;
  discovered_resource_count?: number;
  discovered_prompt_count?: number;
  assigned_specialist_count: number;
  parameters: DashboardRemoteMcpServerParameterRecord[];
  oauth_definition?: DashboardRemoteMcpOauthDefinition | null;
  oauth_client_profile_id?: string | null;
  oauth_client_profile_name?: string | null;
  oauth_connected: boolean;
  oauth_authorized_at: string | null;
  oauth_needs_reauth: boolean;
  created_at: string;
  updated_at: string;
}

export interface DashboardRemoteMcpServerParameterInput {
  id?: string;
  placement: DashboardRemoteMcpParameterPlacement;
  key: string;
  valueKind: 'static' | 'secret';
  value: string;
}

export interface DashboardRemoteMcpServerCreateInput {
  name: string;
  description?: string;
  endpointUrl: string;
  transportPreference?: DashboardRemoteMcpTransportPreference;
  callTimeoutSeconds: number;
  authMode: DashboardRemoteMcpAuthMode;
  enabledByDefaultForNewSpecialists: boolean;
  grantToAllExistingSpecialists: boolean;
  oauthClientProfileId?: string | null;
  oauthDefinition?: DashboardRemoteMcpOauthDefinition | null;
  parameters: DashboardRemoteMcpServerParameterInput[];
}

export interface DashboardRemoteMcpServerUpdateInput {
  name?: string;
  description?: string;
  endpointUrl?: string;
  transportPreference?: DashboardRemoteMcpTransportPreference;
  callTimeoutSeconds?: number;
  authMode?: DashboardRemoteMcpAuthMode;
  enabledByDefaultForNewSpecialists?: boolean;
  oauthClientProfileId?: string | null;
  oauthDefinition?: DashboardRemoteMcpOauthDefinition | null;
  parameters?: DashboardRemoteMcpServerParameterInput[];
}

export type DashboardRemoteMcpAuthorizeResult =
  | {
      kind: 'browser';
      draftId: string;
      authorizeUrl: string;
    }
  | {
      kind: 'device';
      draftId: string;
      deviceFlowId: string;
      userCode: string;
      verificationUri: string;
      verificationUriComplete: string | null;
      expiresInSeconds: number;
      intervalSeconds: number;
    }
  | {
      kind: 'completed';
      serverId: string;
      serverName: string;
    };

export interface DashboardSpecialistSkillRecord {
  id: string;
  name: string;
  slug: string;
  summary: string | null;
  content: string;
  is_archived: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface DashboardSpecialistSkillCreateInput {
  name: string;
  summary?: string;
  content: string;
}

export interface DashboardSpecialistSkillUpdateInput {
  name?: string;
  summary?: string | null;
  content?: string;
}

export interface DashboardRoleDefinitionRecord {
  id: string;
  name: string;
  description: string | null;
  system_prompt?: string | null;
  allowed_tools?: string[];
  model_preference?: string | null;
  verification_strategy?: string | null;
  execution_environment_id?: string | null;
  execution_environment?: DashboardExecutionEnvironmentRecord | null;
  escalation_target?: string | null;
  max_escalation_depth?: number | null;
  is_active: boolean;
  version?: number;
  updated_at?: string | null;
}

export interface DashboardLlmSystemDefaultRecord {
  modelId: string | null;
  reasoningConfig: Record<string, unknown> | null;
}

export interface DashboardLlmAssignmentRecord {
  role_name: string;
  primary_model_id?: string | null;
  reasoning_config?: Record<string, unknown> | null;
}

export interface DashboardLlmProviderCreateInput {
  name: string;
  baseUrl: string;
  apiKeySecretRef: string;
  metadata?: Record<string, unknown>;
}

export interface DashboardOAuthProfileRecord {
  profileId: string;
  displayName: string;
  description: string;
  providerType: string;
  costModel: string;
}

export interface DashboardOAuthStatusRecord {
  connected: boolean;
  email: string | null;
  authorizedAt: string | null;
  expiresAt: string | null;
  authorizedBy: string | null;
  needsReauth: boolean;
}

export interface DashboardEffectiveModelResolution {
  source: 'base' | 'workspace' | 'workflow';
  resolved: {
    provider: {
      name: string;
      providerType: string;
      baseUrl?: string | null;
      apiKeySecretRef?: string | null;
      authMode?: string | null;
      providerId?: string | null;
    };
    model: {
      modelId: string;
      contextWindow?: number | null;
      endpointType?: string | null;
      reasoningConfig?: Record<string, unknown> | null;
    };
    reasoningConfig?: Record<string, unknown> | null;
  } | null;
  fallback: boolean;
  fallback_reason?: string;
}

export interface DashboardWorkflowActivationRecord {
  id: string;
  activation_id?: string;
  workflow_id: string;
  request_id?: string | null;
  reason: string;
  event_type: string;
  payload: Record<string, unknown>;
  state: string;
  queued_at: string;
  started_at?: string | null;
  consumed_at?: string | null;
  completed_at?: string | null;
  summary?: string | null;
  error?: Record<string, unknown> | null;
  recovery_status?: string | null;
  recovery_reason?: string | null;
  recovery_detected_at?: string | null;
  stale_started_at?: string | null;
  redispatched_task_id?: string | null;
  latest_event_at?: string | null;
  event_count?: number;
  events?: Array<{
    id: string;
    activation_id?: string;
    request_id?: string | null;
    reason: string;
    event_type: string;
    payload: Record<string, unknown>;
    state: string;
    queued_at: string;
    started_at?: string | null;
    consumed_at?: string | null;
    completed_at?: string | null;
    summary?: string | null;
    error?: Record<string, unknown> | null;
  }>;
}

export interface DashboardWorkflowActivationEnqueueInput {
  reason: string;
  event_type?: string;
  payload?: Record<string, unknown>;
  request_id?: string;
}

export interface DashboardWorkflowBoardColumn {
  id: string;
  label: string;
  description?: string;
  is_blocked?: boolean;
  is_terminal?: boolean;
}

export interface DashboardWorkflowStageRecord {
  id: string;
  name: string;
  position: number;
  goal: string;
  guidance?: string | null;
  status: string;
  is_active: boolean;
  gate_status: string;
  iteration_count: number;
  summary?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  open_work_item_count: number;
  total_work_item_count: number;
}

export interface DashboardCompletionCallouts {
  residual_risks?: string[];
  unmet_preferred_expectations?: string[];
  waived_steps?: Array<{
    code: string;
    summary?: string | null;
    role?: string | null;
    reason: string;
  }>;
  unresolved_advisory_items?: Array<{
    kind: string;
    id?: string | null;
    summary: string;
  }>;
  completion_notes?: string | null;
}

export interface DashboardWorkflowWorkItemRecordBase {
  id: string;
  workflow_id: string;
  parent_work_item_id?: string | null;
  branch_id?: string | null;
  branch_status?: 'active' | 'completed' | 'blocked' | 'terminated' | null;
  stage_name: string;
  title: string;
  goal?: string | null;
  acceptance_criteria?: string | null;
  column_id: string;
  owner_role?: string | null;
  next_expected_actor?: string | null;
  next_expected_action?: string | null;
  blocked_state?: 'blocked' | null;
  blocked_reason?: string | null;
  escalation_status?: 'open' | null;
  rework_count?: number | null;
  current_subject_revision?: number | null;
  latest_handoff_completion?: string | null;
  latest_handoff_resolution?: string | null;
  assessment_status?: string | null;
  required_assessment_count?: number | null;
  approved_assessment_count?: number | null;
  blocking_assessment_count?: number | null;
  pending_assessment_count?: number | null;
  gate_status?: string | null;
  gate_decision_feedback?: string | null;
  gate_decided_at?: string | null;
  unresolved_findings?: string[];
  focus_areas?: string[];
  known_risks?: string[];
  completion_callouts?: DashboardCompletionCallouts | null;
  priority: string;
  notes?: string | null;
  metadata?: Record<string, unknown> | null;
  completed_at?: string | null;
  task_count?: number;
  children_count?: number;
  children_completed?: number;
  is_milestone?: boolean;
  children?: DashboardWorkflowWorkItemRecord[];
  created_at?: string;
  updated_at?: string;
}

export type DashboardWorkflowWorkItemRecord = DashboardWorkflowWorkItemRecordBase;

export interface DashboardTaskHandoffRecord {
  id: string;
  workflow_id: string;
  work_item_id?: string | null;
  task_id: string;
  request_id?: string | null;
  role: string;
  team_name?: string | null;
  stage_name?: string | null;
  sequence: number;
  summary: string;
  completion: string;
  closure_effect?: 'blocking' | 'advisory' | null;
  completion_callouts?: DashboardCompletionCallouts | null;
  changes: unknown[];
  decisions: unknown[];
  remaining_items: unknown[];
  blockers: unknown[];
  focus_areas: string[];
  known_risks: string[];
  successor_context?: string | null;
  role_data: Record<string, unknown>;
  artifact_ids: string[];
  created_at: string;
}

export interface DashboardWorkItemMemoryEntry {
  key: string;
  value: unknown;
  event_id: number;
  updated_at: string;
  actor_type: string;
  actor_id: string | null;
  workflow_id: string | null;
  work_item_id: string | null;
  task_id: string | null;
  stage_name: string | null;
}

export interface DashboardWorkItemMemoryHistoryEntry extends DashboardWorkItemMemoryEntry {
  event_type: 'updated' | 'deleted';
}

export interface DashboardWorkflowBoardResponse {
  columns: DashboardWorkflowBoardColumn[];
  work_items: DashboardWorkflowWorkItemRecord[];
  active_stages: string[];
  awaiting_gate_count: number;
  stage_summary: Array<{
    name: string;
    goal: string;
    status: string;
    is_active: boolean;
    gate_status: string;
    work_item_count: number;
    open_work_item_count: number;
    completed_count: number;
  }>;
}

export interface DashboardWorkflowRelationRef {
  workflow_id: string;
  name?: string | null;
  state: DashboardWorkflowState;
  playbook_id?: string | null;
  playbook_name?: string | null;
  created_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  is_terminal: boolean;
  link: string;
}

export interface DashboardWorkflowRelations {
  parent: DashboardWorkflowRelationRef | null;
  children: DashboardWorkflowRelationRef[];
  latest_child_workflow_id: string | null;
  child_status_counts: {
    total: number;
    active: number;
    completed: number;
    failed: number;
    cancelled: number;
  };
}

export interface DashboardWorkflowRecordBase {
  id: string;
  name: string;
  state: DashboardWorkflowState;
  created_at: string;
  workspace_id?: string | null;
  workspace_name?: string | null;
  playbook_id?: string | null;
  playbook_name?: string | null;
  lifecycle?: 'planned' | 'ongoing' | null;
  active_stages?: string[];
  work_item_summary?: {
    total_work_items: number;
    open_work_item_count: number;
    blocked_work_item_count?: number;
    completed_work_item_count: number;
    active_stage_count: number;
    awaiting_gate_count: number;
    active_stage_names: string[];
  } | null;
  task_counts?: Record<string, number>;
  metadata?: Record<string, unknown>;
  context?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  completion_callouts?: DashboardCompletionCallouts | null;
  workflow_relations?: DashboardWorkflowRelations | null;
  workflow_stages?: DashboardWorkflowStageRecord[];
  work_items?: DashboardWorkflowWorkItemRecord[];
  activations?: DashboardWorkflowActivationRecord[];
}

export type DashboardWorkflowRecord =
  | (DashboardWorkflowRecordBase & {
      lifecycle: 'ongoing';
      current_stage?: never;
    })
  | (DashboardWorkflowRecordBase & {
      lifecycle?: 'planned' | null;
      current_stage?: string | null;
    });

export interface DashboardWorkspaceTimelineEntry {
  kind?: string;
  workflow_id: string;
  name: string;
  state: DashboardWorkflowState;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  duration_seconds?: number | null;
  task_counts?: Record<string, unknown>;
  stage_progression?: Array<Record<string, unknown>>;
  stage_metrics?: Array<Record<string, unknown>>;
  orchestrator_analytics?: Record<string, unknown>;
  produced_artifacts?: Array<Record<string, unknown>>;
  chain?: Record<string, unknown>;
  link?: string;
  workflow_relations?: DashboardWorkflowRelations;
}

export interface DashboardWorkspaceListSummary {
  active_workflow_count: number;
  completed_workflow_count: number;
  attention_workflow_count: number;
  total_workflow_count: number;
  last_workflow_activity_at: string | null;
}

export interface DashboardWorkspaceRecord {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  repository_url?: string | null;
  is_active?: boolean;
  memory?: Record<string, unknown>;
  settings?: DashboardWorkspaceSettingsRecord;
  summary?: DashboardWorkspaceListSummary;
  git_webhook_provider?: string | null;
  git_webhook_secret_configured?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface DashboardWorkspaceCreateInput {
  name: string;
  slug: string;
  description?: string;
  repository_url?: string;
  settings?: DashboardWorkspaceSettingsInput;
}

export interface DashboardWorkspacePatchInput {
  name?: string;
  slug?: string;
  description?: string;
  repository_url?: string;
  settings?: DashboardWorkspaceSettingsInput;
  is_active?: boolean;
}

export interface DashboardWorkspaceSpecRecord {
  workspace_id: string;
  version?: number;
  resources?: Record<string, unknown>;
  documents?: Record<string, unknown>;
  tools?: Record<string, unknown>;
  config?: Record<string, unknown>;
  instructions?: Record<string, unknown>;
  updated_at?: string;
  created_at?: string | null;
  created_by_type?: string | null;
  created_by_id?: string | null;
}

export interface DashboardWorkspaceSpecEnvelope {
  workspace_id: string;
  version?: number;
  spec?: {
    resources?: Record<string, unknown>;
    documents?: Record<string, unknown>;
    tools?: Record<string, unknown>;
    config?: Record<string, unknown>;
    instructions?: Record<string, unknown>;
  };
  created_at?: string | null;
  created_by_type?: string | null;
  created_by_id?: string | null;
}

export interface DashboardTaskWorkflowRef {
  id: string;
  name?: string | null;
  workspace_id?: string | null;
}

export function normalizeWorkspaceSpecRecord(
  envelope: DashboardWorkspaceSpecEnvelope,
): DashboardWorkspaceSpecRecord {
  return {
    workspace_id: envelope.workspace_id,
    version: envelope.version,
    config: envelope.spec?.config,
    instructions: envelope.spec?.instructions,
    resources: envelope.spec?.resources,
    documents: envelope.spec?.documents,
    tools: envelope.spec?.tools,
    created_at: envelope.created_at,
    created_by_type: envelope.created_by_type,
    created_by_id: envelope.created_by_id,
  };
}

export interface DashboardTaskRecord extends Task {
  workflow?: DashboardTaskWorkflowRef | null;
  workflow_name?: string | null;
  workspace_name?: string | null;
  work_item_id?: string | null;
  work_item_title?: string | null;
  stage_name?: string | null;
  activation_id?: string | null;
  execution_backend: 'runtime_only' | 'runtime_plus_task';
  execution_environment?: DashboardExecutionEnvironmentRecord | null;
  used_task_sandbox: boolean;
}

export interface DashboardPlatformInstructionRecord {
  tenant_id?: string;
  version: number;
  content: string;
  format?: string;
  updated_at?: string | null;
  updated_by_type?: string | null;
  updated_by_id?: string | null;
}

export interface DashboardPlatformInstructionVersionRecord {
  id: string;
  tenant_id?: string;
  version: number;
  content: string;
  format?: string;
  created_at?: string | null;
  created_by_type?: string | null;
  created_by_id?: string | null;
}

export interface DashboardWorkspaceResourceRecord {
  id?: string;
  type?: string;
  name?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface DashboardWorkspaceToolCatalog {
  available?: unknown[];
  blocked?: unknown[];
  [key: string]: unknown;
}

export interface DashboardCostSummaryRecord {
  today: number;
  this_week: number;
  this_month: number;
  budget_total: number;
  budget_remaining: number;
  by_workflow: Array<{ name: string; cost: number }>;
  by_model: Array<{ model: string; cost: number }>;
  daily_trend: Array<{ date: string; cost: number }>;
  totalTokensInput: number;
  totalTokensOutput: number;
  totalCostUsd: number;
  totalWallTimeMs: number;
  eventCount: number;
}

export interface DashboardGovernanceRetentionPolicy {
  task_prune_after_days: number;
  workflow_delete_after_days: number;
  execution_log_retention_days: number;
}

export interface DashboardLoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
}

export interface DashboardResolvedDocumentReference {
  logical_name: string;
  scope: 'workspace' | 'workflow';
  source: 'repository' | 'artifact' | 'external';
  title?: string;
  description?: string;
  metadata: Record<string, unknown>;
  created_at?: string;
  task_id?: string;
  repository?: string;
  path?: string;
  url?: string;
  artifact?: {
    id: string;
    task_id: string;
    logical_path: string;
    content_type?: string;
    download_url: string;
  };
}

export interface DashboardWorkflowDocumentCreateInput {
  logical_name: string;
  source: 'repository' | 'artifact' | 'external';
  title?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  repository?: string;
  path?: string;
  url?: string;
  task_id?: string;
  artifact_id?: string;
  logical_path?: string;
}

export interface DashboardWorkflowDocumentUpdateInput {
  source?: 'repository' | 'artifact' | 'external';
  title?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown>;
  repository?: string | null;
  path?: string | null;
  url?: string | null;
  task_id?: string | null;
  artifact_id?: string | null;
  logical_path?: string | null;
}

export interface DashboardTaskArtifactRecord {
  id: string;
  workflow_id?: string | null;
  workspace_id?: string | null;
  task_id: string;
  logical_path: string;
  content_type: string;
  size_bytes: number;
  checksum_sha256: string;
  metadata: Record<string, unknown>;
  retention_policy: Record<string, unknown>;
  expires_at?: string | null;
  created_at: string;
  download_url: string;
  access_url?: string | null;
  access_url_expires_at?: string | null;
  storage_backend?: string;
}

export interface DashboardWorkspaceArtifactRecord {
  id: string;
  workflow_id: string | null;
  task_id: string;
  logical_path: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
  download_url: string;
  metadata: Record<string, unknown>;
  workflow_name: string;
  workflow_state: string | null;
  work_item_id: string | null;
  work_item_title: string | null;
  stage_name: string | null;
  role: string | null;
  task_title: string;
  task_state: string;
  preview_eligible: boolean;
  preview_mode: 'text' | 'image' | 'pdf' | 'unsupported';
}

export interface DashboardWorkspaceArtifactSummary {
  total_artifacts: number;
  previewable_artifacts: number;
  total_bytes: number;
  workflow_count: number;
  work_item_count: number;
  task_count: number;
  role_count: number;
}

export interface DashboardWorkspaceArtifactWorkflowOption {
  id: string;
  name: string;
}

export interface DashboardWorkspaceArtifactWorkItemOption {
  id: string;
  title: string;
  workflow_id: string | null;
  stage_name: string | null;
}

export interface DashboardWorkspaceArtifactTaskOption {
  id: string;
  title: string;
  workflow_id: string | null;
  work_item_id: string | null;
  stage_name: string | null;
}

export interface DashboardWorkspaceArtifactResponse {
  data: DashboardWorkspaceArtifactRecord[];
  meta: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
    has_more: boolean;
    summary: DashboardWorkspaceArtifactSummary;
    filters: {
      workflows: DashboardWorkspaceArtifactWorkflowOption[];
      work_items: DashboardWorkspaceArtifactWorkItemOption[];
      tasks: DashboardWorkspaceArtifactTaskOption[];
      stages: string[];
      roles: string[];
      content_types: string[];
    };
  };
}

export interface DashboardTaskArtifactContent {
  content_type: string;
  content_text: string;
  file_name?: string | null;
  size_bytes: number;
}

export interface DashboardTaskArtifactDownload {
  blob: Blob;
  content_type: string;
  file_name?: string | null;
  size_bytes: number;
}

export interface DashboardWorkspaceArtifactFileDownload {
  blob: Blob;
  content_type: string;
  file_name?: string | null;
  size_bytes: number;
}

export interface DashboardTaskArtifactUploadInput {
  path: string;
  content_base64: string;
  content_type?: string;
  metadata?: Record<string, unknown>;
}

export interface DashboardCustomizationManagedFile {
  source: string;
  target: string;
}

export interface DashboardCustomizationSetupScript {
  path: string;
  sha256: string;
}

export interface DashboardCustomizationReasoning {
  orchestrator_level?: 'low' | 'medium' | 'high';
  internal_workers_level?: 'low' | 'medium' | 'high';
}

export interface DashboardCustomizationManifest {
  template: string;
  base_image: string;
  customizations?: {
    apt?: string[];
    npm_global?: string[];
    pip?: string[];
    files?: DashboardCustomizationManagedFile[];
    setup_script?: DashboardCustomizationSetupScript;
  };
  reasoning?: DashboardCustomizationReasoning;
}

export interface DashboardCustomizationValidationError {
  field_path: string;
  rule_id: string;
  message: string;
  remediation: string;
}

export interface DashboardCustomizationValidateResponse {
  valid: boolean;
  manifest: DashboardCustomizationManifest;
  errors?: DashboardCustomizationValidationError[];
}

export interface DashboardCustomizationGate {
  name: string;
  status: string;
  message?: string;
}

export interface DashboardCustomizationWaiver {
  gate: string;
  scope?: string;
  environment?: string;
  reason?: string;
  ticket?: string;
  approved_by?: string[];
  expires_at?: string;
}

export interface DashboardCustomizationBuildInputs {
  template_version?: string;
  policy_bundle_version?: string;
  lock_digests?: Record<string, string>;
  build_args?: Record<string, string>;
  secret_refs?: Array<{ id: string; version: string }>;
}

export interface DashboardCustomizationTrustPolicy {
  environment?: string;
}

export interface DashboardCustomizationTrustEvidence {
  vulnerability?: {
    critical_findings?: number;
    high_findings?: number;
  };
  sbom?: {
    format?: string;
    digest?: string;
  };
  provenance?: {
    verified?: boolean;
    source_revision?: string;
    builder_id?: string;
    ciih?: string;
    digest?: string;
  };
  signature?: {
    verified?: boolean;
    trusted_identity?: string;
  };
}

export interface DashboardCustomizationBuildResponse {
  build_id?: string;
  state: string;
  ciih?: string;
  digest?: string;
  manifest: DashboardCustomizationManifest;
  inputs?: DashboardCustomizationBuildInputs;
  trust_policy?: DashboardCustomizationTrustPolicy;
  gates?: DashboardCustomizationGate[];
  waivers?: DashboardCustomizationWaiver[];
  auto_link_requested?: boolean;
  link_ready: boolean;
  link_blocked_reason?: string;
  reused?: boolean;
  errors?: DashboardCustomizationValidationError[];
  error?: string;
}

export interface DashboardCustomizationStatusResponse {
  state: string;
  customization_enabled: boolean;
  configured_digest?: string;
  active_digest?: string;
  pending_rollout_digest?: string;
  resolved_reasoning: DashboardCustomizationReasoning;
}

export interface DashboardCustomizationLinkResponse {
  build_id?: string;
  state: string;
  ciih?: string;
  digest?: string;
  gates?: DashboardCustomizationGate[];
  linked: boolean;
  configured_digest?: string;
  active_digest?: string;
  link_blocked_reason?: string;
  reused?: boolean;
  error?: string;
}

export interface DashboardCustomizationRollbackResponse {
  current_build_id?: string;
  target_build_id?: string;
  state: string;
  current_digest?: string;
  target_digest?: string;
  previous_digest?: string;
  configured_digest?: string;
  active_digest?: string;
  target_gates?: DashboardCustomizationGate[];
  rolled_back: boolean;
  rollback_blocked_reason?: string;
  error?: string;
}

export interface DashboardCustomizationProfile {
  profile_id?: string;
  name?: string;
  scope?: string;
  manifest_checksum?: string;
  latest_gated_digest?: string;
  created_by?: string;
  updated_at?: string;
  inference_metadata?: Record<string, string>;
  manifest: DashboardCustomizationManifest;
}

export interface DashboardCustomizationInspectResponse {
  state: string;
  manifest: DashboardCustomizationManifest;
  profile: DashboardCustomizationProfile;
  field_confidence?: Record<string, string>;
  non_inferable_fields?: string[];
}

export interface DashboardCustomizationExportResponse {
  artifact_type?: string;
  format?: string;
  path?: string;
  checksum?: string;
  content?: string;
  redaction_applied: boolean;
  scan_passed: boolean;
  findings?: Array<{ rule_id: string; location: string; message: string }>;
  error?: string;
}

export interface FleetStatusResponse {
  global_max_runtimes: number;
  total_running: number;
  total_idle: number;
  total_executing: number;
  total_draining: number;
  worker_pools: FleetWorkerPoolSummary[];
  by_playbook: Array<{
    playbook_id: string;
    playbook_name: string;
    pool_mode: 'warm' | 'cold';
    max_runtimes: number;
    running: number;
    idle: number;
    executing: number;
    pending_tasks: number;
    active_workflows: number;
  }>;
  by_playbook_pool: FleetPlaybookPoolSummary[];
  recent_events: FleetEventRecord[];
}

export interface FleetWorkerPoolSummary {
  pool_kind: 'orchestrator' | 'specialist';
  desired_workers: number;
  desired_replicas: number;
  enabled_workers: number;
  draining_workers: number;
  running_containers: number;
}

export interface FleetPlaybookPoolSummary {
  playbook_id: string;
  playbook_name: string;
  pool_kind: 'orchestrator' | 'specialist';
  pool_mode: 'warm' | 'cold';
  max_runtimes: number;
  running: number;
  idle: number;
  executing: number;
  pending_tasks: number;
  active_workflows: number;
  draining: number;
}

export interface FleetEventRecord {
  id: string;
  event_type: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  runtime_id?: string | null;
  playbook_id?: string | null;
  task_id?: string | null;
  workflow_id?: string | null;
  container_id?: string | null;
  payload?: Record<string, unknown>;
  created_at: string;
}

export interface QueueDepthResponse {
  total: number;
  by_playbook?: Record<string, number>;
}

export interface LogEntry {
  id: number;
  trace_id: string;
  span_id: string;
  parent_span_id?: string | null;
  source: string;
  category: string;
  level: string;
  operation: string;
  status: string;
  duration_ms?: number | null;
  payload?: Record<string, unknown> | null;
  error?: { code?: string; message: string } | null;
  workspace_id?: string | null;
  workspace_name?: string | null;
  workflow_id?: string | null;
  workflow_name?: string | null;
  task_id?: string | null;
  work_item_id?: string | null;
  stage_name?: string | null;
  activation_id?: string | null;
  is_orchestrator_task?: boolean | null;
  task_title?: string | null;
  role?: string | null;
  execution_backend?: 'runtime_only' | 'runtime_plus_task' | null;
  tool_owner?: 'runtime' | 'task' | null;
  execution_environment_id?: string | null;
  execution_environment_name?: string | null;
  execution_environment_image?: string | null;
  execution_environment_distro?: string | null;
  execution_environment_package_manager?: string | null;
  actor_type: string;
  actor_id: string;
  actor_name?: string | null;
  resource_type?: string | null;
  resource_id?: string | null;
  resource_name?: string | null;
  created_at: string;
}

export interface LogPagination {
  per_page: number;
  has_more: boolean;
  next_cursor?: string | null;
  prev_cursor?: string | null;
}

export interface LogQueryResponse {
  data: LogEntry[];
  pagination: LogPagination;
}

export interface LogStatGroup {
  group: string;
  count: number;
  error_count: number;
  total_duration_ms: number;
  avg_duration_ms: number;
  agg: Record<string, unknown>;
}

export interface LogStatsResponse {
  data: {
    groups: LogStatGroup[];
    totals: { count: number; error_count: number; total_duration_ms: number };
  };
}

export interface LogOperationRecord {
  operation: string;
  count: number;
}

export interface LogOperationValueRecord {
  operation: string;
}

export interface LogRoleRecord {
  role: string;
  count: number;
}

export interface LogRoleValueRecord {
  role: string;
}

export interface LogActorRecord {
  actor_kind: string;
  actor_id: string | null;
  actor_name: string | null;
  latest_role?: string | null;
  latest_workflow_id?: string | null;
  latest_workflow_name?: string | null;
  latest_workflow_label?: string | null;
  count: number;
}

export interface LogActorKindValueRecord {
  actor_kind: string;
}

export interface LogWorkflowValueRecord {
  id: string;
  name: string | null;
  workspace_id: string | null;
}

export interface FleetWorkerActualRecord {
  id: string;
  desired_state_id: string;
  container_id: string | null;
  container_status: string | null;
  cpu_usage_percent: number | null;
  memory_usage_bytes: number | null;
  network_rx_bytes: number | null;
  network_tx_bytes: number | null;
  started_at: string | null;
  last_updated: string;
}

export interface FleetWorkerRecord {
  id: string;
  worker_name: string;
  role: string;
  pool_kind: 'orchestrator' | 'specialist';
  runtime_image: string;
  cpu_limit: string;
  memory_limit: string;
  network_policy: string;
  environment: Record<string, unknown>;
  llm_provider: string | null;
  llm_model: string | null;
  llm_api_key_secret_ref_configured?: boolean;
  replicas: number;
  enabled: boolean;
  restart_requested: boolean;
  draining: boolean;
  version: number;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
  actual: FleetWorkerActualRecord[];
}

export interface DashboardLiveContainerRecord {
  id: string;
  kind: 'orchestrator' | 'runtime' | 'task';
  execution_backend?: 'runtime_only' | 'runtime_plus_task' | null;
  container_id: string;
  name: string;
  state: string;
  status: string;
  image: string;
  cpu_limit: string | null;
  memory_limit: string | null;
  started_at: string | null;
  last_seen_at: string;
  role_name?: string | null;
  playbook_id?: string | null;
  playbook_name?: string | null;
  workflow_id?: string | null;
  workflow_name?: string | null;
  task_id?: string | null;
  task_title?: string | null;
  stage_name?: string | null;
  activity_state?: string | null;
  execution_environment_id?: string | null;
  execution_environment_name?: string | null;
  execution_environment_image?: string | null;
  execution_environment_distro?: string | null;
  execution_environment_package_manager?: string | null;
}

export interface DashboardApi {
  login(apiKey: string, persistentSession?: boolean): Promise<void>;
  logout(): Promise<void>;
  listWorkflows(
    filters?: Record<string, string>,
  ): Promise<{ data: DashboardWorkflowRecord[]; meta?: Record<string, unknown> }>;
  listWorkspaces(): Promise<{ data: DashboardWorkspaceRecord[]; meta?: Record<string, unknown> }>;
  createWorkspace(payload: DashboardWorkspaceCreateInput): Promise<DashboardWorkspaceRecord>;
  patchWorkspace(
    workspaceId: string,
    payload: DashboardWorkspacePatchInput,
  ): Promise<DashboardWorkspaceRecord>;
  verifyWorkspaceGitAccess(
    workspaceId: string,
    payload: DashboardWorkspaceGitAccessVerifyInput,
  ): Promise<DashboardWorkspaceGitAccessVerifyResult>;
  getWorkspace(workspaceId: string): Promise<DashboardWorkspaceRecord>;
  getPlatformInstructions(): Promise<DashboardPlatformInstructionRecord>;
  updatePlatformInstructions(payload: {
    content: string;
    format?: 'text' | 'markdown';
  }): Promise<DashboardPlatformInstructionRecord>;
  clearPlatformInstructions(): Promise<DashboardPlatformInstructionRecord>;
  listPlatformInstructionVersions(): Promise<DashboardPlatformInstructionVersionRecord[]>;
  getPlatformInstructionVersion(
    version: number,
  ): Promise<DashboardPlatformInstructionVersionRecord>;
  getOrchestratorConfig(): Promise<{ prompt: string; updatedAt: string }>;
  updateOrchestratorConfig(payload: {
    prompt: string;
  }): Promise<{ prompt: string; updatedAt: string }>;
  getWorkspaceSpec(workspaceId: string): Promise<DashboardWorkspaceSpecRecord>;
  listWorkspaceArtifacts(
    workspaceId: string,
    filters?: Record<string, string>,
  ): Promise<DashboardWorkspaceArtifactResponse>;
  listWorkspaceArtifactFiles(workspaceId: string): Promise<DashboardWorkspaceArtifactFileRecord[]>;
  downloadWorkspaceArtifactFile(
    workspaceId: string,
    fileId: string,
  ): Promise<DashboardWorkspaceArtifactFileDownload>;
  uploadWorkspaceArtifactFiles(
    workspaceId: string,
    payload: DashboardWorkspaceArtifactFileUploadInput[],
  ): Promise<DashboardWorkspaceArtifactFileRecord[]>;
  deleteWorkspaceArtifactFile(workspaceId: string, fileId: string): Promise<void>;
  updateWorkspaceSpec(
    workspaceId: string,
    payload: Record<string, unknown>,
  ): Promise<DashboardWorkspaceSpecRecord>;
  listWorkspaceResources(
    workspaceId: string,
  ): Promise<{ data: DashboardWorkspaceResourceRecord[] }>;
  listWorkspaceTools(workspaceId: string): Promise<{ data: DashboardWorkspaceToolCatalog }>;
  patchWorkspaceMemory(
    workspaceId: string,
    payload: { key: string; value: unknown },
  ): Promise<DashboardWorkspaceRecord>;
  removeWorkspaceMemory(workspaceId: string, key: string): Promise<DashboardWorkspaceRecord>;
  configureGitWebhook(
    workspaceId: string,
    payload: { provider: string; secret: string },
  ): Promise<Record<string, unknown>>;
  getWorkflow(id: string): Promise<DashboardWorkflowRecord>;
  getWorkflowRail(input?: {
    mode?: DashboardWorkflowRailMode;
    page?: number;
    perPage?: number;
    needsActionOnly?: boolean;
    ongoingOnly?: boolean;
    search?: string;
    workflowId?: string;
  }): Promise<DashboardWorkflowRailPacket>;
  getWorkflowWorkspace(
    workflowId: string,
    input?: {
      workItemId?: string;
      taskId?: string;
      tabScope?: 'workflow' | 'selected_work_item' | 'selected_task';
      liveConsoleLimit?: number;
      historyLimit?: number;
      deliverablesLimit?: number;
      boardMode?: string;
      boardFilters?: string;
      liveConsoleAfter?: string;
      historyAfter?: string;
      deliverablesAfter?: string;
    },
  ): Promise<DashboardWorkflowWorkspacePacket>;
  getAgenticSettings(): Promise<DashboardAgenticSettingsRecord>;
  updateAgenticSettings(
    payload: DashboardAgenticSettingsPatchInput,
  ): Promise<DashboardAgenticSettingsRecord>;
  getWorkflowSettings(workflowId: string): Promise<DashboardWorkflowSettingsRecord>;
  updateWorkflowSettings(
    workflowId: string,
    payload: DashboardWorkflowSettingsPatchInput,
  ): Promise<DashboardWorkflowSettingsRecord>;
  getMissionControlLive(input?: {
    page?: number;
    perPage?: number;
  }): Promise<DashboardMissionControlLiveResponse>;
  getMissionControlRecent(input?: {
    limit?: number;
  }): Promise<DashboardMissionControlRecentResponse>;
  getMissionControlHistory(input?: {
    workflowId?: string;
    limit?: number;
  }): Promise<DashboardMissionControlHistoryResponse>;
  getMissionControlWorkflowWorkspace(
    workflowId: string,
    input?: {
      historyLimit?: number;
      outputLimit?: number;
    },
  ): Promise<DashboardMissionControlWorkspaceResponse>;
  listWorkflowInputPackets(workflowId: string): Promise<DashboardWorkflowInputPacketRecord[]>;
  createWorkflowInputPacket(
    workflowId: string,
    payload: DashboardWorkflowInputPacketCreateInput,
  ): Promise<DashboardWorkflowInputPacketRecord>;
  listWorkflowInterventions(workflowId: string): Promise<DashboardWorkflowInterventionRecord[]>;
  createWorkflowIntervention(
    workflowId: string,
    payload: DashboardWorkflowInterventionCreateInput,
  ): Promise<DashboardWorkflowInterventionRecord>;
  listWorkflowSteeringSessions(workflowId: string): Promise<DashboardWorkflowSteeringSessionRecord[]>;
  createWorkflowSteeringSession(
    workflowId: string,
    payload?: DashboardWorkflowSteeringSessionCreateInput,
  ): Promise<DashboardWorkflowSteeringSessionRecord>;
  listWorkflowSteeringMessages(
    workflowId: string,
    sessionId: string,
  ): Promise<DashboardWorkflowSteeringMessageRecord[]>;
  createWorkflowSteeringRequest(
    workflowId: string,
    payload: DashboardWorkflowSteeringRequestInput,
  ): Promise<DashboardWorkflowSteeringRequestResult>;
  appendWorkflowSteeringMessage(
    workflowId: string,
    sessionId: string,
    payload: DashboardWorkflowSteeringMessageCreateInput,
  ): Promise<DashboardWorkflowSteeringMessageRecord>;
  redriveWorkflow(
    workflowId: string,
    payload: DashboardWorkflowRedriveInput,
  ): Promise<DashboardWorkflowRedriveResult>;
  getWorkflowBudget(workflowId: string): Promise<DashboardWorkflowBudgetRecord>;
  getWorkflowBoard(workflowId: string): Promise<DashboardWorkflowBoardResponse>;
  listWorkflowStages(workflowId: string): Promise<DashboardWorkflowStageRecord[]>;
  listWorkflowEvents(
    workflowId: string,
    filters?: Record<string, string>,
  ): Promise<DashboardEventPage>;
  listWorkflowWorkItems(workflowId: string): Promise<DashboardWorkflowWorkItemRecord[]>;
  getWorkflowWorkItem(
    workflowId: string,
    workItemId: string,
  ): Promise<DashboardWorkflowWorkItemRecord>;
  listWorkflowWorkItemTasks(
    workflowId: string,
    workItemId: string,
  ): Promise<Record<string, unknown>[]>;
  listWorkflowWorkItemEvents(
    workflowId: string,
    workItemId: string,
    limit?: number,
  ): Promise<DashboardEventRecord[]>;
  listWorkflowWorkItemHandoffs(
    workflowId: string,
    workItemId: string,
  ): Promise<DashboardTaskHandoffRecord[]>;
  getLatestWorkflowWorkItemHandoff(
    workflowId: string,
    workItemId: string,
  ): Promise<DashboardTaskHandoffRecord | null>;
  getWorkflowWorkItemMemory(
    workflowId: string,
    workItemId: string,
  ): Promise<{ entries: DashboardWorkItemMemoryEntry[] }>;
  getWorkflowWorkItemMemoryHistory(
    workflowId: string,
    workItemId: string,
    limit?: number,
  ): Promise<{ history: DashboardWorkItemMemoryHistoryEntry[] }>;
  listWorkflowActivations(workflowId: string): Promise<DashboardWorkflowActivationRecord[]>;
  enqueueWorkflowActivation(
    workflowId: string,
    payload: DashboardWorkflowActivationEnqueueInput,
  ): Promise<DashboardWorkflowActivationRecord>;
  listWorkflowDocuments(workflowId: string): Promise<DashboardResolvedDocumentReference[]>;
  createWorkflowDocument(
    workflowId: string,
    payload: DashboardWorkflowDocumentCreateInput,
  ): Promise<DashboardResolvedDocumentReference>;
  updateWorkflowDocument(
    workflowId: string,
    logicalName: string,
    payload: DashboardWorkflowDocumentUpdateInput,
  ): Promise<DashboardResolvedDocumentReference>;
  deleteWorkflowDocument(workflowId: string, logicalName: string): Promise<void>;
  listPlaybooks(): Promise<{ data: DashboardPlaybookRecord[] }>;
  getPlaybook(playbookId: string): Promise<DashboardPlaybookRecord>;
  createPlaybook(payload: {
    name: string;
    slug?: string;
    description?: string;
    outcome: string;
    lifecycle?: 'planned' | 'ongoing';
    definition: Record<string, unknown>;
  }): Promise<DashboardPlaybookRecord>;
  updatePlaybook(
    playbookId: string,
    payload: {
      name: string;
      slug?: string;
      description?: string;
      outcome: string;
      lifecycle?: 'planned' | 'ongoing';
      definition: Record<string, unknown>;
    },
  ): Promise<DashboardPlaybookRecord>;
  archivePlaybook(playbookId: string): Promise<DashboardPlaybookRecord>;
  restorePlaybook(playbookId: string): Promise<DashboardPlaybookRecord>;
  deletePlaybook(playbookId: string): Promise<void>;
  getPlaybookDeleteImpact(playbookId: string): Promise<DashboardPlaybookDeleteImpact>;
  deletePlaybookPermanently(playbookId: string): Promise<void>;
  listToolTags(): Promise<DashboardToolTagRecord[]>;
  createToolTag(payload: DashboardToolTagCreateInput): Promise<DashboardToolTagRecord>;
  updateToolTag(
    toolId: string,
    payload: DashboardToolTagUpdateInput,
  ): Promise<DashboardToolTagRecord>;
  deleteToolTag(toolId: string): Promise<void>;
  listRuntimeDefaults(): Promise<DashboardRuntimeDefaultRecord[]>;
  upsertRuntimeDefault(input: DashboardRuntimeDefaultUpsertInput): Promise<void>;
  deleteRuntimeDefault(id: string): Promise<void>;
  listExecutionEnvironmentCatalog(): Promise<DashboardExecutionEnvironmentCatalogRecord[]>;
  listExecutionEnvironments(): Promise<DashboardExecutionEnvironmentRecord[]>;
  createExecutionEnvironment(
    payload: DashboardExecutionEnvironmentCreateInput,
  ): Promise<DashboardExecutionEnvironmentRecord>;
  createExecutionEnvironmentFromCatalog(
    payload: DashboardExecutionEnvironmentCreateFromCatalogInput,
  ): Promise<DashboardExecutionEnvironmentRecord>;
  updateExecutionEnvironment(
    environmentId: string,
    payload: DashboardExecutionEnvironmentUpdateInput,
  ): Promise<DashboardExecutionEnvironmentRecord>;
  verifyExecutionEnvironment(environmentId: string): Promise<DashboardExecutionEnvironmentRecord>;
  setDefaultExecutionEnvironment(
    environmentId: string,
  ): Promise<DashboardExecutionEnvironmentRecord>;
  archiveExecutionEnvironment(environmentId: string): Promise<DashboardExecutionEnvironmentRecord>;
  restoreExecutionEnvironment(environmentId: string): Promise<DashboardExecutionEnvironmentRecord>;
  listRemoteMcpOAuthClientProfiles(): Promise<DashboardRemoteMcpOAuthClientProfileRecord[]>;
  getRemoteMcpOAuthClientProfile(profileId: string): Promise<DashboardRemoteMcpOAuthClientProfileRecord>;
  createRemoteMcpOAuthClientProfile(
    payload: DashboardRemoteMcpOAuthClientProfileCreateInput,
  ): Promise<DashboardRemoteMcpOAuthClientProfileRecord>;
  updateRemoteMcpOAuthClientProfile(
    profileId: string,
    payload: DashboardRemoteMcpOAuthClientProfileUpdateInput,
  ): Promise<DashboardRemoteMcpOAuthClientProfileRecord>;
  deleteRemoteMcpOAuthClientProfile(profileId: string): Promise<void>;
  listRemoteMcpServers(): Promise<DashboardRemoteMcpServerRecord[]>;
  getRemoteMcpServer(serverId: string): Promise<DashboardRemoteMcpServerRecord>;
  createRemoteMcpServer(
    payload: DashboardRemoteMcpServerCreateInput,
  ): Promise<DashboardRemoteMcpServerRecord>;
  updateRemoteMcpServer(
    serverId: string,
    payload: DashboardRemoteMcpServerUpdateInput,
  ): Promise<DashboardRemoteMcpServerRecord>;
  initiateRemoteMcpOAuthAuthorization(
    payload: DashboardRemoteMcpServerCreateInput,
  ): Promise<DashboardRemoteMcpAuthorizeResult>;
  reconnectRemoteMcpOAuth(serverId: string): Promise<DashboardRemoteMcpAuthorizeResult>;
  pollRemoteMcpOAuthDeviceAuthorization(deviceFlowId: string): Promise<DashboardRemoteMcpAuthorizeResult>;
  disconnectRemoteMcpOAuth(serverId: string): Promise<void>;
  reverifyRemoteMcpServer(serverId: string): Promise<DashboardRemoteMcpServerRecord>;
  deleteRemoteMcpServer(serverId: string): Promise<void>;
  listSpecialistSkills(): Promise<DashboardSpecialistSkillRecord[]>;
  getSpecialistSkill(skillId: string): Promise<DashboardSpecialistSkillRecord>;
  createSpecialistSkill(
    payload: DashboardSpecialistSkillCreateInput,
  ): Promise<DashboardSpecialistSkillRecord>;
  updateSpecialistSkill(
    skillId: string,
    payload: DashboardSpecialistSkillUpdateInput,
  ): Promise<DashboardSpecialistSkillRecord>;
  deleteSpecialistSkill(skillId: string): Promise<void>;
  saveRoleDefinition(
    roleId: string | null,
    payload: Record<string, unknown>,
  ): Promise<DashboardRoleDefinitionRecord>;
  deleteRoleDefinition(roleId: string): Promise<void>;
  getLlmSystemDefault(): Promise<DashboardLlmSystemDefaultRecord>;
  updateLlmSystemDefault(payload: DashboardLlmSystemDefaultRecord): Promise<void>;
  listLlmAssignments(): Promise<DashboardLlmAssignmentRecord[]>;
  updateLlmAssignment(
    roleName: string,
    payload: { primaryModelId?: string; reasoningConfig?: Record<string, unknown> | null },
  ): Promise<void>;
  createLlmProvider(payload: DashboardLlmProviderCreateInput): Promise<DashboardLlmProviderRecord>;
  deleteLlmProvider(providerId: string): Promise<void>;
  discoverLlmModels(providerId: string): Promise<unknown[]>;
  updateLlmModel(modelId: string, payload: Record<string, unknown>): Promise<void>;
  listOAuthProfiles(): Promise<DashboardOAuthProfileRecord[]>;
  initiateOAuthFlow(profileId: string): Promise<{ authorizeUrl: string }>;
  getOAuthProviderStatus(providerId: string): Promise<DashboardOAuthStatusRecord>;
  disconnectOAuthProvider(providerId: string): Promise<void>;
  listLlmProviders(): Promise<DashboardLlmProviderRecord[]>;
  listLlmModels(): Promise<DashboardLlmModelRecord[]>;
  createWorkflow(payload: {
    playbook_id: string;
    name: string;
    workspace_id?: string;
    parameters?: Record<string, string>;
    initial_input_packet?: {
      summary?: string;
      files?: Array<{
        file_name: string;
        description?: string;
        content_base64: string;
        content_type?: string;
      }>;
    };
    metadata?: Record<string, unknown>;
    config_overrides?: Record<string, unknown>;
    instruction_config?: Record<string, unknown>;
    budget?: DashboardWorkflowBudgetInput;
  }): Promise<DashboardWorkflowRecord>;
  createWorkflowWorkItem(
    workflowId: string,
    payload: {
      request_id?: string;
      parent_work_item_id?: string;
      stage_name?: string;
      title: string;
      goal?: string;
      acceptance_criteria?: string;
      column_id?: string;
      owner_role?: string;
      priority?: 'critical' | 'high' | 'normal' | 'low';
      notes?: string;
      metadata?: Record<string, unknown>;
      initial_input_packet?: {
        summary?: string;
        structured_inputs?: Record<string, unknown>;
        files?: Array<{
          file_name: string;
          description?: string;
          content_base64: string;
          content_type?: string;
        }>;
      };
    },
  ): Promise<DashboardWorkflowWorkItemRecord>;
  updateWorkflowWorkItem(
    workflowId: string,
    workItemId: string,
    payload: {
      parent_work_item_id?: string | null;
      title?: string;
      goal?: string;
      acceptance_criteria?: string;
      stage_name?: string;
      column_id?: string;
      owner_role?: string | null;
      priority?: 'critical' | 'high' | 'normal' | 'low';
      notes?: string | null;
      metadata?: Record<string, unknown>;
    },
  ): Promise<DashboardWorkflowWorkItemRecord>;
  retryWorkflowWorkItem(
    workflowId: string,
    workItemId: string,
    payload?: { override_input?: Record<string, unknown>; force?: boolean },
  ): Promise<unknown>;
  skipWorkflowWorkItem(
    workflowId: string,
    workItemId: string,
    payload: { reason: string },
  ): Promise<unknown>;
  reassignWorkflowWorkItemTask(
    workflowId: string,
    workItemId: string,
    taskId: string,
    payload: {
      request_id?: string;
      preferred_agent_id?: string;
      preferred_worker_id?: string;
      reason: string;
    },
  ): Promise<unknown>;
  approveWorkflowWorkItemTask(
    workflowId: string,
    workItemId: string,
    taskId: string,
  ): Promise<unknown>;
  approveWorkflowWorkItemTaskOutput(
    workflowId: string,
    workItemId: string,
    taskId: string,
  ): Promise<unknown>;
  rejectWorkflowWorkItemTask(
    workflowId: string,
    workItemId: string,
    taskId: string,
    payload: { feedback: string },
  ): Promise<unknown>;
  requestWorkflowWorkItemTaskChanges(
    workflowId: string,
    workItemId: string,
    taskId: string,
    payload: {
      feedback: string;
      override_input?: Record<string, unknown>;
      preferred_agent_id?: string;
      preferred_worker_id?: string;
    },
  ): Promise<unknown>;
  retryWorkflowWorkItemTask(
    workflowId: string,
    workItemId: string,
    taskId: string,
    payload?: { override_input?: Record<string, unknown>; force?: boolean },
  ): Promise<unknown>;
  skipWorkflowWorkItemTask(
    workflowId: string,
    workItemId: string,
    taskId: string,
    payload: { reason: string },
  ): Promise<unknown>;
  resolveWorkflowWorkItemTaskEscalation(
    workflowId: string,
    workItemId: string,
    taskId: string,
    payload: { instructions: string; context?: Record<string, unknown> },
  ): Promise<unknown>;
  cancelWorkflowWorkItemTask(
    workflowId: string,
    workItemId: string,
    taskId: string,
  ): Promise<unknown>;
  overrideWorkflowWorkItemTaskOutput(
    workflowId: string,
    workItemId: string,
    taskId: string,
    payload: { output: unknown; reason: string },
  ): Promise<unknown>;
  cancelWorkflow(workflowId: string): Promise<unknown>;
  chainWorkflow(
    workflowId: string,
    payload: {
      playbook_id: string;
      name?: string;
      parameters?: Record<string, string>;
    },
  ): Promise<unknown>;
  listTasks(filters?: Record<string, string>): Promise<ApiListResponse<DashboardTaskRecord>>;
  getTask(id: string): Promise<DashboardTaskRecord>;
  listTaskArtifacts(taskId: string): Promise<DashboardTaskArtifactRecord[]>;
  uploadTaskArtifact(
    taskId: string,
    payload: DashboardTaskArtifactUploadInput,
  ): Promise<DashboardTaskArtifactRecord>;
  readTaskArtifactContent(
    taskId: string,
    artifactId: string,
  ): Promise<DashboardTaskArtifactContent>;
  downloadTaskArtifact(taskId: string, artifactId: string): Promise<DashboardTaskArtifactDownload>;
  readBinaryContentByHref(href: string): Promise<DashboardTaskArtifactContent>;
  downloadBinaryByHref(href: string): Promise<DashboardTaskArtifactDownload>;
  deleteTaskArtifact(taskId: string, artifactId: string): Promise<void>;
  listWorkers(): Promise<unknown>;
  listAgents(): Promise<DashboardAgentRecord[]>;
  approveTask(taskId: string): Promise<unknown>;
  approveTaskOutput(taskId: string): Promise<unknown>;
  retryTask(
    taskId: string,
    payload?: { override_input?: Record<string, unknown>; force?: boolean },
  ): Promise<unknown>;
  cancelTask(taskId: string): Promise<unknown>;
  rejectTask(taskId: string, payload: { feedback: string }): Promise<unknown>;
  requestTaskChanges(
    taskId: string,
    payload: {
      feedback: string;
      override_input?: Record<string, unknown>;
      preferred_agent_id?: string;
      preferred_worker_id?: string;
    },
  ): Promise<unknown>;
  skipTask(taskId: string, payload: { reason: string }): Promise<unknown>;
  reassignTask(
    taskId: string,
    payload: { preferred_agent_id?: string; preferred_worker_id?: string; reason: string },
  ): Promise<unknown>;
  escalateTask(
    taskId: string,
    payload: { reason: string; escalation_target?: string },
  ): Promise<unknown>;
  resolveEscalation(
    taskId: string,
    payload: { instructions: string; context?: Record<string, unknown> },
  ): Promise<unknown>;
  resolveTaskEscalation(
    taskId: string,
    payload: { instructions: string; context?: Record<string, unknown> },
    options?: { workflowId?: string | null; workItemId?: string | null },
  ): Promise<unknown>;
  actOnWorkflowGate(
    workflowId: string,
    gateId: string,
    payload: { action: 'approve' | 'reject' | 'request_changes' | 'block'; feedback?: string },
  ): Promise<unknown>;
  overrideTaskOutput(
    taskId: string,
    payload: { output: unknown; reason: string },
  ): Promise<unknown>;
  pauseWorkflow(workflowId: string): Promise<unknown>;
  resumeWorkflow(workflowId: string): Promise<unknown>;
  getWorkspaceTimeline(workspaceId: string): Promise<DashboardWorkspaceTimelineEntry[]>;
  createPlanningWorkflow(
    workspaceId: string,
    payload: { brief: string; name?: string },
  ): Promise<unknown>;
  listRoleDefinitions(): Promise<DashboardRoleDefinitionRecord[]>;
  getCostSummary(): Promise<DashboardCostSummaryRecord>;
  getRetentionPolicy(): Promise<DashboardGovernanceRetentionPolicy>;
  updateRetentionPolicy(
    payload: Partial<DashboardGovernanceRetentionPolicy>,
  ): Promise<DashboardGovernanceRetentionPolicy>;
  getLoggingConfig(): Promise<DashboardLoggingConfig>;
  updateLoggingConfig(payload: DashboardLoggingConfig): Promise<DashboardLoggingConfig>;
  listEvents(filters?: Record<string, string>): Promise<DashboardEventPage>;
  listApiKeys(): Promise<DashboardApiKeyRecord[]>;
  createApiKey(payload: {
    scope: 'agent' | 'worker' | 'admin' | 'service';
    owner_type?: string;
    owner_id?: string;
    label?: string;
    expires_at?: string | null;
  }): Promise<{ api_key: string; key_prefix: string }>;
  revokeApiKey(id: string): Promise<unknown>;
  search(query: string): Promise<DashboardSearchResult[]>;
  fetchFleetStatus(): Promise<FleetStatusResponse>;
  fetchFleetEvents(
    filters?: Record<string, string>,
  ): Promise<{ data: FleetEventRecord[]; total: number }>;
  fetchFleetWorkers(): Promise<FleetWorkerRecord[]>;
  createFleetWorker(payload: {
    workerName: string;
    role: string;
    poolKind?: 'orchestrator' | 'specialist';
    runtimeImage: string;
    cpuLimit?: string;
    memoryLimit?: string;
    networkPolicy?: string;
    environment?: Record<string, unknown>;
    llmProvider?: string;
    llmModel?: string;
    llmApiKeySecretRef?: string;
    replicas?: number;
    enabled?: boolean;
  }): Promise<FleetWorkerRecord>;
  updateFleetWorker(
    workerId: string,
    payload: {
      role?: string;
      poolKind?: 'orchestrator' | 'specialist';
      runtimeImage?: string;
      cpuLimit?: string;
      memoryLimit?: string;
      networkPolicy?: string;
      environment?: Record<string, unknown>;
      llmProvider?: string;
      llmModel?: string;
      llmApiKeySecretRef?: string;
      replicas?: number;
      enabled?: boolean;
    },
  ): Promise<FleetWorkerRecord>;
  restartFleetWorker(workerId: string): Promise<unknown>;
  drainFleetWorker(workerId: string): Promise<unknown>;
  deleteFleetWorker(workerId: string): Promise<void>;
  fetchLiveContainers(): Promise<DashboardLiveContainerRecord[]>;
  fetchQueueDepth(playbookId?: string): Promise<QueueDepthResponse>;
  getMetrics(): Promise<string>;
  getCustomizationStatus(): Promise<DashboardCustomizationStatusResponse>;
  validateCustomization(payload: {
    manifest: DashboardCustomizationManifest;
  }): Promise<DashboardCustomizationValidateResponse>;
  createCustomizationBuild(payload: {
    manifest: DashboardCustomizationManifest;
    auto_link?: boolean;
    inputs?: DashboardCustomizationBuildInputs;
    trust_policy?: DashboardCustomizationTrustPolicy;
    trust_evidence?: DashboardCustomizationTrustEvidence;
    waivers?: DashboardCustomizationWaiver[];
  }): Promise<DashboardCustomizationBuildResponse>;
  getCustomizationBuild(id: string): Promise<DashboardCustomizationBuildResponse>;
  linkCustomizationBuild(payload: {
    build_id: string;
  }): Promise<DashboardCustomizationLinkResponse>;
  rollbackCustomizationBuild(payload: {
    current_build_id: string;
    target_build_id: string;
  }): Promise<DashboardCustomizationRollbackResponse>;
  reconstructCustomization(): Promise<DashboardCustomizationInspectResponse>;
  exportCustomization(payload: {
    artifact_type?: 'manifest' | 'profile' | 'template';
    format?: 'json' | 'yaml';
  }): Promise<DashboardCustomizationExportResponse>;
  queryLogs(filters: Record<string, string>): Promise<LogQueryResponse>;
  getLog(logId: string | number): Promise<{ data: LogEntry }>;
  getLogStats(filters: Record<string, string>): Promise<LogStatsResponse>;
  getLogOperations(filters?: Record<string, string>): Promise<{ data: LogOperationRecord[] }>;
  getLogRoles(filters?: Record<string, string>): Promise<{ data: LogRoleRecord[] }>;
  getLogActors(filters?: Record<string, string>): Promise<{ data: LogActorRecord[] }>;
  getLogOperationValues(
    filters?: Record<string, string>,
  ): Promise<{ data: LogOperationValueRecord[] }>;
  getLogRoleValues(filters?: Record<string, string>): Promise<{ data: LogRoleValueRecord[] }>;
  getLogActorKindValues(
    filters?: Record<string, string>,
  ): Promise<{ data: LogActorKindValueRecord[] }>;
  getLogWorkflowValues(
    filters?: Record<string, string>,
  ): Promise<{ data: LogWorkflowValueRecord[] }>;
  exportLogs(filters: Record<string, string>): Promise<Blob>;
  getWorkspaceDeleteImpact(workspaceId: string): Promise<DashboardDeleteImpactSummary>;
  deleteWorkspace(workspaceId: string, options?: { cascade?: boolean }): Promise<void>;
}
