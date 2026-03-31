import type {
  TaskState,
  WorkflowState,
} from '@agirunner/sdk';
import type {
  DashboardMissionControlActionAvailability,
  DashboardMissionControlWorkflowCard,
  DashboardWorkflowOperationsSnapshot,
  DashboardWorkflowNeedsActionPacket,
  DashboardWorkflowLiveConsolePacket,
  DashboardWorkflowHistoryPacket,
  DashboardWorkflowBriefsPacket,
  DashboardWorkflowDeliverablesPacket,
  DashboardWorkflowStickyStrip,
  DashboardWorkflowBottomTabsPacket,
  DashboardWorkflowBoardResponse,
  DashboardWorkflowRecord,
} from '../models.js';
export type DashboardTaskState = TaskState;

export type DashboardWorkflowState = WorkflowState;

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
