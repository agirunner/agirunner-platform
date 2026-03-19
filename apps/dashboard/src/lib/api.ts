import {
  PlatformApiClient,
  type ApiListResponse,
  type Task,
  type TaskState,
  type WorkflowState,
} from '@agirunner/sdk';

import { clearSession, readSession, writeSession } from './session.js';

const API_BASE_URL = import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';

interface DashboardApiOptions {
  baseUrl?: string;
  client?: PlatformApiClient;
  fetcher?: typeof fetch;
}

interface NamedRecord {
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
  capabilities?: string[] | null;
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
  expires_at: string;
  is_revoked: boolean;
  created_at: string;
}

export interface DashboardResolvedConfigResponse {
  workflow_id: string;
  resolved_config: Record<string, unknown>;
  config_layers?: Record<string, Record<string, unknown>>;
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

export type DashboardWorkspaceSettingsRecord = Record<string, unknown> & {
  default_branch?: string | null;
  git_user_name?: string | null;
  git_user_email?: string | null;
  credentials?: DashboardWorkspaceCredentialPosture;
  model_overrides?: Record<string, DashboardRoleModelOverride>;
  workspace_brief?: string | null;
};

export type DashboardWorkspaceSettingsInput = Record<string, unknown> & {
  default_branch?: string | null;
  git_user_name?: string | null;
  git_user_email?: string | null;
  credentials?: DashboardWorkspaceCredentialInput;
  model_overrides?: Record<string, DashboardRoleModelOverride>;
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
  is_enabled?: boolean;
}

export interface DashboardToolTagRecord {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
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

export interface DashboardOutboundWebhookRecord {
  id: string;
  url: string;
  event_types: string[];
  is_active: boolean;
  created_at?: string;
}

export interface DashboardOutboundWebhookCreateInput {
  url: string;
  event_types: string[];
  secret?: string;
}

export interface DashboardOutboundWebhookUpdateInput {
  url?: string;
  event_types?: string[];
  is_active?: boolean;
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
  configType: 'string' | 'number';
  description: string;
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

export interface DashboardWorkspaceModelOverridesResponse {
  workspace_id: string;
  model_overrides: Record<string, DashboardRoleModelOverride>;
}

export interface DashboardWorkspaceResolvedModelsResponse {
  workspace_id: string;
  workspace_model_overrides: Record<string, DashboardRoleModelOverride>;
  effective_models: Record<string, DashboardEffectiveModelResolution>;
}

export interface DashboardWorkflowModelOverridesResponse {
  workflow_id: string;
  model_overrides: Record<string, DashboardRoleModelOverride>;
}

export interface DashboardWorkflowResolvedModelsResponse {
  workflow_id: string;
  workspace_id?: string | null;
  workspace_model_overrides: Record<string, DashboardRoleModelOverride>;
  workflow_model_overrides: Record<string, DashboardRoleModelOverride>;
  effective_models: Record<string, DashboardEffectiveModelResolution>;
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
  human_gate: boolean;
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

export interface DashboardWorkflowWorkItemRecordBase {
  id: string;
  workflow_id: string;
  parent_work_item_id?: string | null;
  stage_name: string;
  title: string;
  goal?: string | null;
  acceptance_criteria?: string | null;
  column_id: string;
  owner_role?: string | null;
  next_expected_actor?: string | null;
  next_expected_action?: string | null;
  rework_count?: number | null;
  latest_handoff_completion?: string | null;
  unresolved_findings?: string[];
  review_focus?: string[];
  known_risks?: string[];
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
  changes: unknown[];
  decisions: unknown[];
  remaining_items: unknown[];
  blockers: unknown[];
  review_focus: string[];
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

interface DashboardWorkflowRecordBase {
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
    completed_work_item_count: number;
    active_stage_count: number;
    awaiting_gate_count: number;
    active_stage_names: string[];
  } | null;
  task_counts?: Record<string, number>;
  metadata?: Record<string, unknown>;
  context?: Record<string, unknown>;
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

export interface DashboardApprovalTaskRecord {
  id: string;
  title: string;
  state: DashboardTaskState;
  workflow_id?: string | null;
  workflow_name?: string | null;
  work_item_id?: string | null;
  work_item_title?: string | null;
  stage_name?: string | null;
  next_expected_actor?: string | null;
  next_expected_action?: string | null;
  role?: string | null;
  activation_id?: string | null;
  rework_count?: number;
  handoff_count?: number;
  latest_handoff?: {
    role?: string | null;
    stage_name?: string | null;
    summary?: string | null;
    completion?: string | null;
    successor_context?: string | null;
    created_at?: string | null;
  } | null;
  created_at: string;
  output?: unknown;
}

export interface DashboardApprovalStageGateRecord {
  id: string;
  gate_id: string;
  workflow_id: string;
  workflow_name: string;
  stage_id?: string | null;
  stage_name: string;
  stage_goal: string;
  status?: string;
  gate_status: string;
  summary?: string | null;
  recommendation?: string | null;
  concerns: string[];
  key_artifacts: Array<Record<string, unknown>>;
  requested_by_type?: string | null;
  requested_by_id?: string | null;
  decided_by_type?: string | null;
  decided_by_id?: string | null;
  decision_feedback?: string | null;
  human_decision?: {
    action?: 'approve' | 'reject' | 'request_changes' | null;
    decided_by_type?: string | null;
    decided_by_id?: string | null;
    feedback?: string | null;
    decided_at?: string | null;
  } | null;
  requested_by_task?: {
    id: string;
    title?: string | null;
    role?: string | null;
    work_item_id?: string | null;
    work_item_title?: string | null;
  } | null;
  orchestrator_resume?: {
    activation_id: string;
    state?: string | null;
    event_type?: string | null;
    reason?: string | null;
    queued_at?: string | null;
    started_at?: string | null;
    completed_at?: string | null;
    summary?: string | null;
    error?: Record<string, unknown> | null;
    latest_event_at?: string | null;
    event_count?: number;
    task?: {
      id: string;
      title?: string | null;
      state?: string | null;
      started_at?: string | null;
      completed_at?: string | null;
    } | null;
  } | null;
  orchestrator_resume_history?: Array<{
    activation_id: string;
    state?: string | null;
    event_type?: string | null;
    reason?: string | null;
    queued_at?: string | null;
    started_at?: string | null;
    completed_at?: string | null;
    summary?: string | null;
    error?: Record<string, unknown> | null;
    latest_event_at?: string | null;
    event_count?: number;
    task?: {
      id: string;
      title?: string | null;
      state?: string | null;
      started_at?: string | null;
      completed_at?: string | null;
    } | null;
  }>;
  requested_at?: string;
  decided_at?: string | null;
  updated_at: string;
}

export interface DashboardApprovalQueueResponse {
  task_approvals: DashboardApprovalTaskRecord[];
  stage_gates: DashboardApprovalStageGateRecord[];
}

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

interface DashboardWorkspaceSpecEnvelope {
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

function normalizeWorkspaceSpecRecord(
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

export interface DashboardWebhookWorkItemTriggerRecord {
  id: string;
  name: string;
  source: string;
  workspace_id?: string | null;
  workflow_id: string;
  event_header?: string | null;
  event_types?: string[];
  signature_header: string;
  signature_mode: 'hmac_sha256' | 'shared_secret';
  field_mappings?: Record<string, unknown>;
  defaults?: Record<string, unknown>;
  is_active: boolean;
  secret_configured?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface DashboardScheduledWorkItemTriggerRecord {
  id: string;
  name: string;
  source: string;
  workspace_id?: string | null;
  workflow_id: string;
  schedule_type: 'interval' | 'daily_time';
  cadence_minutes: number | null;
  daily_time?: string | null;
  timezone?: string | null;
  defaults?: Record<string, unknown>;
  is_active: boolean;
  last_fired_at?: string | null;
  next_fire_at: string;
  created_at?: string;
  updated_at?: string;
}

export interface DashboardIntegrationRecord {
  id: string;
  kind: 'webhook' | 'slack' | 'otlp_http' | 'github_issues';
  workflow_id?: string | null;
  subscriptions: string[];
  is_active: boolean;
  config: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
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
  task_archive_after_days: number;
  task_delete_after_days: number;
  execution_log_retention_days: number;
}

export interface DashboardLoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
}

export interface DashboardConfigAssistantResponse {
  reply: string;
  suggestions?: Array<{
    path: string;
    current_value?: string;
    suggested_value: string;
    description: string;
  }>;
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

export interface LogRoleRecord {
  role: string;
  count: number;
}

export interface LogActorRecord {
  actor_type: string;
  actor_id: string;
  actor_name: string;
  count: number;
}

export interface FleetContainerRecord {
  id: string;
  container_id: string | null;
  name: string;
  status: string;
  image: string;
  worker_role: string;
  pool_kind?: 'orchestrator' | 'specialist' | null;
  cpu_usage_percent: number | null;
  memory_usage_bytes: number | null;
  started_at: string | null;
  last_updated: string;
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

export interface FleetImageRecord {
  repository: string;
  tag: string | null;
  digest: string | null;
  size_bytes: number | null;
  last_seen: string;
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
  getWorkspace(workspaceId: string): Promise<DashboardWorkspaceRecord>;
  getWorkspaceModelOverrides(workspaceId: string): Promise<DashboardWorkspaceModelOverridesResponse>;
  getResolvedWorkspaceModels(
    workspaceId: string,
    roles?: string[],
  ): Promise<DashboardWorkspaceResolvedModelsResponse>;
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
  listWorkspaceResources(workspaceId: string): Promise<{ data: DashboardWorkspaceResourceRecord[] }>;
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
  listWebhookWorkItemTriggers(): Promise<{ data: DashboardWebhookWorkItemTriggerRecord[] }>;
  createWebhookWorkItemTrigger(payload: {
    name: string;
    source: string;
    workspace_id?: string;
    workflow_id: string;
    event_header?: string;
    event_types?: string[];
    signature_header: string;
    signature_mode: 'hmac_sha256' | 'shared_secret';
    secret: string;
    field_mappings?: Record<string, unknown>;
    defaults?: Record<string, unknown>;
    is_active?: boolean;
  }): Promise<DashboardWebhookWorkItemTriggerRecord>;
  updateWebhookWorkItemTrigger(
    triggerId: string,
    payload: Partial<{
      name: string;
      source: string;
      workspace_id: string | null;
      workflow_id: string;
      event_header: string | null;
      event_types: string[];
      signature_header: string;
      signature_mode: 'hmac_sha256' | 'shared_secret';
      secret: string;
      field_mappings: Record<string, unknown>;
      defaults: Record<string, unknown>;
      is_active: boolean;
    }>,
  ): Promise<DashboardWebhookWorkItemTriggerRecord>;
  deleteWebhookWorkItemTrigger(triggerId: string): Promise<void>;
  listScheduledWorkItemTriggers(): Promise<{ data: DashboardScheduledWorkItemTriggerRecord[] }>;
  createScheduledWorkItemTrigger(payload: {
    name: string;
    source?: string;
    workspace_id?: string;
    workflow_id: string;
    schedule_type?: 'interval' | 'daily_time';
    cadence_minutes?: number | null;
    daily_time?: string | null;
    timezone?: string | null;
    defaults?: Record<string, unknown>;
    is_active?: boolean;
    next_fire_at?: string;
  }): Promise<DashboardScheduledWorkItemTriggerRecord>;
  updateScheduledWorkItemTrigger(
    triggerId: string,
    payload: Partial<{
      name: string;
      source: string | null;
      workspace_id: string | null;
      workflow_id: string;
      schedule_type: 'interval' | 'daily_time';
      cadence_minutes: number | null;
      daily_time: string | null;
      timezone: string | null;
      defaults: Record<string, unknown>;
      is_active: boolean;
      next_fire_at: string;
    }>,
  ): Promise<DashboardScheduledWorkItemTriggerRecord>;
  deleteScheduledWorkItemTrigger(triggerId: string): Promise<void>;
  getWorkflow(id: string): Promise<DashboardWorkflowRecord>;
  getWorkflowBudget(workflowId: string): Promise<DashboardWorkflowBudgetRecord>;
  getWorkflowModelOverrides(workflowId: string): Promise<DashboardWorkflowModelOverridesResponse>;
  getResolvedWorkflowModels(
    workflowId: string,
    roles?: string[],
  ): Promise<DashboardWorkflowResolvedModelsResponse>;
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
  listToolTags(): Promise<DashboardToolTagRecord[]>;
  createToolTag(payload: DashboardToolTagCreateInput): Promise<DashboardToolTagRecord>;
  updateToolTag(
    toolId: string,
    payload: DashboardToolTagUpdateInput,
  ): Promise<DashboardToolTagRecord>;
  deleteToolTag(toolId: string): Promise<void>;
  listWebhooks(): Promise<DashboardOutboundWebhookRecord[]>;
  createWebhook(
    payload: DashboardOutboundWebhookCreateInput,
  ): Promise<DashboardOutboundWebhookRecord>;
  updateWebhook(
    id: string,
    payload: DashboardOutboundWebhookUpdateInput,
  ): Promise<DashboardOutboundWebhookRecord>;
  deleteWebhook(id: string): Promise<void>;
  listRuntimeDefaults(): Promise<DashboardRuntimeDefaultRecord[]>;
  upsertRuntimeDefault(input: DashboardRuntimeDefaultUpsertInput): Promise<void>;
  deleteRuntimeDefault(id: string): Promise<void>;
  saveRoleDefinition(
    roleId: string | null,
    payload: Record<string, unknown>,
  ): Promise<{ id: string; name: string; description: string | null; is_active: boolean }>;
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
    parameters?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    config_overrides?: Record<string, unknown>;
    instruction_config?: Record<string, unknown>;
    model_overrides?: Record<string, DashboardRoleModelOverride>;
    budget?: DashboardWorkflowBudgetInput;
  }): Promise<DashboardWorkflowRecord>;
  previewEffectiveModels(payload: {
    roles?: string[];
    workspace_model_overrides?: Record<string, DashboardRoleModelOverride>;
    workflow_model_overrides?: Record<string, DashboardRoleModelOverride>;
  }): Promise<{
    roles: string[];
    workspace_model_overrides: Record<string, DashboardRoleModelOverride>;
    workflow_model_overrides: Record<string, DashboardRoleModelOverride>;
    effective_models: Record<string, DashboardEffectiveModelResolution>;
  }>;
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
      parameters?: Record<string, unknown>;
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
  deleteTaskArtifact(taskId: string, artifactId: string): Promise<void>;
  listWorkers(): Promise<unknown>;
  listAgents(): Promise<DashboardAgentRecord[]>;
  getApprovalQueue(): Promise<DashboardApprovalQueueResponse>;
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
  overrideTaskOutput(
    taskId: string,
    payload: { output: unknown; reason: string },
  ): Promise<unknown>;
  pauseWorkflow(workflowId: string): Promise<unknown>;
  resumeWorkflow(workflowId: string): Promise<unknown>;
  getResolvedWorkflowConfig(
    workflowId: string,
    showLayers?: boolean,
  ): Promise<DashboardResolvedConfigResponse>;
  getWorkspaceTimeline(workspaceId: string): Promise<DashboardWorkspaceTimelineEntry[]>;
  createPlanningWorkflow(
    workspaceId: string,
    payload: { brief: string; name?: string },
  ): Promise<unknown>;
  listRoleDefinitions(): Promise<
    Array<{ id: string; name: string; description: string | null; is_active: boolean }>
  >;
  listIntegrations(): Promise<DashboardIntegrationRecord[]>;
  getCostSummary(): Promise<DashboardCostSummaryRecord>;
  createIntegration(payload: {
    kind: DashboardIntegrationRecord['kind'];
    workflow_id?: string;
    subscriptions?: string[];
    config: Record<string, unknown>;
  }): Promise<DashboardIntegrationRecord>;
  updateIntegration(
    integrationId: string,
    payload: {
      subscriptions?: string[];
      is_active?: boolean;
      config?: Record<string, unknown>;
    },
  ): Promise<DashboardIntegrationRecord>;
  deleteIntegration(integrationId: string): Promise<void>;
  getRetentionPolicy(): Promise<DashboardGovernanceRetentionPolicy>;
  updateRetentionPolicy(
    payload: Partial<DashboardGovernanceRetentionPolicy>,
  ): Promise<DashboardGovernanceRetentionPolicy>;
  getLoggingConfig(): Promise<DashboardLoggingConfig>;
  updateLoggingConfig(payload: DashboardLoggingConfig): Promise<DashboardLoggingConfig>;
  listEvents(filters?: Record<string, string>): Promise<DashboardEventPage>;
  listApiKeys(): Promise<DashboardApiKeyRecord[]>;
  createApiKey(payload: {
    scope: 'agent' | 'worker' | 'admin';
    owner_type: string;
    owner_id?: string;
    label?: string;
    expires_at: string;
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
  fetchFleetContainers(): Promise<FleetContainerRecord[]>;
  fetchFleetImages(): Promise<FleetImageRecord[]>;
  pruneFleetContainers(): Promise<{ removed: number }>;
  pullFleetImage(payload: {
    repository: string;
    tag: string;
  }): Promise<{ repository: string; tag: string }>;
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
  exportLogs(filters: Record<string, string>): Promise<Blob>;
  deleteWorkspace(workspaceId: string): Promise<void>;
  askConfigAssistant(question: string): Promise<DashboardConfigAssistantResponse>;
}

export function createDashboardApi(options: DashboardApiOptions = {}): DashboardApi {
  const baseUrl = options.baseUrl ?? API_BASE_URL;
  const session = readSession();
  const defaultManualWorkflowActivationEventType = 'operator.manual_enqueue';
  const client =
    options.client ??
    new PlatformApiClient({
      baseUrl,
      accessToken: session?.accessToken ?? undefined,
    });
  const requestFetch = options.fetcher ?? fetch;

  // Deduplicate concurrent refresh calls — only one in-flight at a time.
  let refreshPromise: Promise<{ token: string }> | null = null;

  async function doRefresh(): Promise<{ token: string }> {
    if (refreshPromise) return refreshPromise;
    refreshPromise = client.refreshSession().finally(() => {
      refreshPromise = null;
    });
    return refreshPromise;
  }

  async function withRefresh<T>(handler: () => Promise<T>): Promise<T> {
    try {
      return await handler();
    } catch (error) {
      const message = String(error);
      if (!message.includes('HTTP 401')) {
        throw error;
      }

      const activeSession = readSession();
      if (!activeSession) {
        throw error;
      }

      try {
        const refreshed = await doRefresh();
        writeSession({
          accessToken: refreshed.token,
          tenantId: activeSession.tenantId,
          persistentSession: activeSession.persistentSession,
        });
        client.setAccessToken(refreshed.token);
        return await handler();
      } catch (refreshError) {
        clearSession();
        if (typeof window !== 'undefined') {
          window.location.assign('/login');
        }
        throw refreshError;
      }
    }
  }

  async function requestJson<T>(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      body?: Record<string, unknown>;
      includeAuth?: boolean;
      allowNoContent?: boolean;
    } = {},
  ): Promise<T> {
    const activeSession = readSession();
    const headers: Record<string, string> = {};

    if (options.body) {
      headers['Content-Type'] = 'application/json';
    }

    if ((options.includeAuth ?? true) && activeSession?.accessToken) {
      headers.Authorization = `Bearer ${activeSession.accessToken}`;
    }

    const response = await requestFetch(`${baseUrl}${path}`, {
      method: options.method ?? 'POST',
      headers,
      credentials: 'include',
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      throw new Error(await buildHttpErrorMessage(response));
    }

    if (options.allowNoContent && response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  async function requestData<T>(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      body?: Record<string, unknown>;
    } = {},
  ): Promise<T> {
    const response = await requestJson<{ data: T }>(path, options);
    return response.data;
  }

  function requestWorkflowControlAction(path: string): Promise<unknown> {
    return requestData<unknown>(path, {
      body: buildRequestBodyWithRequestId({}),
    });
  }

  function requestWorkflowWorkItemTaskAction(
    workflowId: string,
    workItemId: string,
    taskId: string,
    action: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    return requestJson(
      `/api/v1/workflows/${workflowId}/work-items/${workItemId}/tasks/${taskId}/${action}`,
      {
        body: buildRequestBodyWithRequestId(body),
      },
    );
  }

  function requestWorkflowWorkItemAction(
    workflowId: string,
    workItemId: string,
    action: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    return requestJson(`/api/v1/workflows/${workflowId}/work-items/${workItemId}/${action}`, {
      body: buildRequestBodyWithRequestId(body),
    });
  }

  function normalizeEventPage(page: {
    data?: DashboardEventRecord[];
    meta?: { has_more?: boolean; next_after?: string | number | null };
  }): DashboardEventPage {
    return {
      data: page.data ?? [],
      meta: {
        has_more: Boolean(page.meta?.has_more),
        next_after:
          page.meta?.next_after === null || page.meta?.next_after === undefined
            ? null
            : String(page.meta.next_after),
      },
    };
  }

  async function requestBinary(
    path: string,
    options: { method?: 'GET'; includeAuth?: boolean } = {},
  ): Promise<Response> {
    const activeSession = readSession();
    const headers: Record<string, string> = {};

    if ((options.includeAuth ?? true) && activeSession?.accessToken) {
      headers.Authorization = `Bearer ${activeSession.accessToken}`;
    }

    const response = await requestFetch(resolvePlatformPath(path), {
      method: options.method ?? 'GET',
      headers,
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error(await buildHttpErrorMessage(response));
    }

    return response;
  }

  function resolvePlatformPath(path: string): string {
    const resolved = new URL(path, baseUrl);
    const platformOrigin = new URL(baseUrl).origin;
    if (resolved.origin !== platformOrigin) {
      throw new Error('Artifact access must remain on the platform API origin');
    }
    return resolved.toString();
  }

  async function buildHttpErrorMessage(response: Response): Promise<string> {
    const fallback = `HTTP ${response.status}`;
    const contentType = response.headers.get('content-type') ?? '';

    try {
      if (contentType.includes('application/json')) {
        const payload = (await response.json()) as {
          error?: { message?: string; details?: { issues?: unknown } };
          message?: string;
        };
        const message = payload.error?.message ?? payload.message;
        const issues = formatValidationIssueDetails(payload.error?.details?.issues);
        const detailMessage = issues ? `${message ?? 'Validation failed'} (${issues})` : message;
        return detailMessage ? `HTTP ${response.status}: ${detailMessage}` : fallback;
      }

      const text = (await response.text()).trim();
      return text ? `HTTP ${response.status}: ${text}` : fallback;
    } catch {
      return fallback;
    }
  }

  function formatValidationIssueDetails(value: unknown): string | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const details = value as {
      fieldErrors?: Record<string, string[] | undefined>;
      formErrors?: string[];
    };
    const fieldMessages = Object.values(details.fieldErrors ?? {})
      .flatMap((messages) => messages ?? [])
      .filter((message) => typeof message === 'string' && message.trim().length > 0);
    const formMessages = (details.formErrors ?? []).filter(
      (message) => typeof message === 'string' && message.trim().length > 0,
    );
    const messages = [...fieldMessages, ...formMessages];
    return messages.length > 0 ? messages.join(' ') : null;
  }

  function readContentDispositionFileName(headerValue: string | null): string | null {
    if (!headerValue) {
      return null;
    }
    const utf8Match = headerValue.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match) {
      return decodeURIComponent(utf8Match[1]);
    }
    const basicMatch = headerValue.match(/filename=\"?([^\";]+)\"?/i);
    return basicMatch?.[1] ?? null;
  }

  return {
    async login(apiKey: string, persistentSession = true): Promise<void> {
      const auth = await client.exchangeApiKey(apiKey, persistentSession);
      writeSession({
        accessToken: auth.token,
        tenantId: auth.tenant_id,
        persistentSession,
      });
      client.setAccessToken(auth.token);
    },
    async logout(): Promise<void> {
      try {
        await requestJson('/api/v1/auth/logout', { method: 'POST' });
      } finally {
        clearSession();
      }
    },
    listWorkflows: (filters) => withRefresh(() => client.listWorkflows(filters ?? {})),
    listWorkspaces: () =>
      withRefresh(
        () =>
          requestJson('/api/v1/workspaces?per_page=50', { method: 'GET' }) as Promise<{
            data: DashboardWorkspaceRecord[];
            meta?: Record<string, unknown>;
          }>,
      ),
    createWorkspace: (payload) =>
      withRefresh(() =>
        requestData<DashboardWorkspaceRecord>('/api/v1/workspaces', {
          body: payload as unknown as Record<string, unknown>,
        }),
      ),
    patchWorkspace: (workspaceId, payload) =>
      withRefresh(() =>
        requestData<DashboardWorkspaceRecord>(`/api/v1/workspaces/${workspaceId}`, {
          method: 'PATCH',
          body: payload as Record<string, unknown>,
        }),
      ),
    getWorkspace: (workspaceId) =>
      withRefresh(() =>
        requestData<DashboardWorkspaceRecord>(`/api/v1/workspaces/${workspaceId}`, {
          method: 'GET',
        }),
      ),
    getWorkspaceModelOverrides: (workspaceId) =>
      withRefresh(() =>
        requestData<DashboardWorkspaceModelOverridesResponse>(
          `/api/v1/workspaces/${workspaceId}/model-overrides`,
          { method: 'GET' },
        ),
      ),
    getResolvedWorkspaceModels: (workspaceId, roles) =>
      withRefresh(() =>
        requestData<DashboardWorkspaceResolvedModelsResponse>(
          `/api/v1/workspaces/${workspaceId}/model-overrides/resolved${buildRolesQuery(roles)}`,
          { method: 'GET' },
        ),
      ),
    getPlatformInstructions: () =>
      withRefresh(() =>
        requestData<DashboardPlatformInstructionRecord>('/api/v1/platform/instructions', {
          method: 'GET',
        }),
      ),
    updatePlatformInstructions: (payload) =>
      withRefresh(() =>
        requestData<DashboardPlatformInstructionRecord>('/api/v1/platform/instructions', {
          method: 'PUT',
          body: payload as Record<string, unknown>,
        }),
      ),
    clearPlatformInstructions: () =>
      withRefresh(() =>
        requestData<DashboardPlatformInstructionRecord>('/api/v1/platform/instructions', {
          method: 'DELETE',
        }),
      ),
    listPlatformInstructionVersions: () =>
      withRefresh(() =>
        requestData<DashboardPlatformInstructionVersionRecord[]>(
          '/api/v1/platform/instructions/versions',
          {
            method: 'GET',
          },
        ),
      ),
    getPlatformInstructionVersion: (version) =>
      withRefresh(() =>
        requestData<DashboardPlatformInstructionVersionRecord>(
          `/api/v1/platform/instructions/versions/${version}`,
          {
            method: 'GET',
          },
        ),
      ),
    getOrchestratorConfig: () =>
      withRefresh(() =>
        requestData<{ prompt: string; updatedAt: string }>('/api/v1/config/orchestrator', {
          method: 'GET',
        }),
      ),
    updateOrchestratorConfig: (payload) =>
      withRefresh(() =>
        requestData<{ prompt: string; updatedAt: string }>('/api/v1/config/orchestrator', {
          method: 'PUT',
          body: payload as Record<string, unknown>,
        }),
      ),
    getWorkspaceSpec: (workspaceId) =>
      withRefresh(async () =>
        normalizeWorkspaceSpecRecord(
          await requestData<DashboardWorkspaceSpecEnvelope>(`/api/v1/workspaces/${workspaceId}/spec`, {
            method: 'GET',
          }),
        ),
      ),
    updateWorkspaceSpec: (workspaceId, payload) =>
      withRefresh(async () =>
        normalizeWorkspaceSpecRecord(
          await requestData<DashboardWorkspaceSpecEnvelope>(`/api/v1/workspaces/${workspaceId}/spec`, {
            method: 'PUT',
            body: payload,
          }),
        ),
      ),
    listWorkspaceResources: (workspaceId) =>
      withRefresh(() =>
        requestJson<{ data: DashboardWorkspaceResourceRecord[] }>(
          `/api/v1/workspaces/${workspaceId}/resources`,
          {
            method: 'GET',
          },
        ),
      ),
    listWorkspaceTools: (workspaceId) =>
      withRefresh(() =>
        requestJson<{ data: DashboardWorkspaceToolCatalog }>(`/api/v1/workspaces/${workspaceId}/tools`, {
          method: 'GET',
        }),
      ),
    patchWorkspaceMemory: (workspaceId, payload) =>
      withRefresh(() =>
        requestData<DashboardWorkspaceRecord>(`/api/v1/workspaces/${workspaceId}/memory`, {
          method: 'PATCH',
          body: payload as Record<string, unknown>,
        }),
      ),
    removeWorkspaceMemory: (workspaceId, key) =>
      withRefresh(() =>
        requestData<DashboardWorkspaceRecord>(
          `/api/v1/workspaces/${workspaceId}/memory/${encodeURIComponent(key)}`,
          {
            method: 'DELETE',
          },
        ),
      ),
    configureGitWebhook: (workspaceId, payload) =>
      withRefresh(() =>
        requestData<Record<string, unknown>>(`/api/v1/workspaces/${workspaceId}/git-webhook`, {
          method: 'PUT',
          body: payload as Record<string, unknown>,
        }),
      ),
    listWebhookWorkItemTriggers: () =>
      withRefresh(() =>
        requestJson<{ data: DashboardWebhookWorkItemTriggerRecord[] }>(
          '/api/v1/work-item-triggers',
          {
            method: 'GET',
          },
        ),
      ),
    createWebhookWorkItemTrigger: (payload) =>
      withRefresh(() =>
        requestData<DashboardWebhookWorkItemTriggerRecord>('/api/v1/work-item-triggers', {
          method: 'POST',
          body: payload as Record<string, unknown>,
        }),
      ),
    updateWebhookWorkItemTrigger: (triggerId, payload) =>
      withRefresh(() =>
        requestData<DashboardWebhookWorkItemTriggerRecord>(
          `/api/v1/work-item-triggers/${triggerId}`,
          {
            method: 'PATCH',
            body: payload as Record<string, unknown>,
          },
        ),
      ),
    deleteWebhookWorkItemTrigger: (triggerId) =>
      withRefresh(() =>
        requestJson<Record<string, never>>(`/api/v1/work-item-triggers/${triggerId}`, {
          method: 'DELETE',
        }).then(() => undefined),
      ),
    listScheduledWorkItemTriggers: () =>
      withRefresh(() =>
        requestJson<{ data: DashboardScheduledWorkItemTriggerRecord[] }>(
          '/api/v1/scheduled-work-item-triggers',
          {
            method: 'GET',
          },
        ),
      ),
    createScheduledWorkItemTrigger: (payload) =>
      withRefresh(() =>
        requestData<DashboardScheduledWorkItemTriggerRecord>(
          '/api/v1/scheduled-work-item-triggers',
          {
            method: 'POST',
            body: payload as Record<string, unknown>,
          },
        ),
      ),
    updateScheduledWorkItemTrigger: (triggerId, payload) =>
      withRefresh(() =>
        requestData<DashboardScheduledWorkItemTriggerRecord>(
          `/api/v1/scheduled-work-item-triggers/${triggerId}`,
          {
            method: 'PATCH',
            body: payload as Record<string, unknown>,
          },
        ),
      ),
    deleteScheduledWorkItemTrigger: (triggerId) =>
      withRefresh(() =>
        requestJson<Record<string, never>>(`/api/v1/scheduled-work-item-triggers/${triggerId}`, {
          method: 'DELETE',
        }).then(() => undefined),
      ),
    getWorkflow: (id) => withRefresh(() => client.getWorkflow(id)),
    getWorkflowBudget: (workflowId) =>
      withRefresh(() =>
        requestData<DashboardWorkflowBudgetRecord>(`/api/v1/workflows/${workflowId}/budget`, {
          method: 'GET',
        }),
      ),
    getWorkflowModelOverrides: (workflowId) =>
      withRefresh(() =>
        requestData<DashboardWorkflowModelOverridesResponse>(
          `/api/v1/workflows/${workflowId}/model-overrides`,
          { method: 'GET' },
        ),
      ),
    getResolvedWorkflowModels: (workflowId, roles) =>
      withRefresh(() =>
        requestData<DashboardWorkflowResolvedModelsResponse>(
          `/api/v1/workflows/${workflowId}/model-overrides/resolved${buildRolesQuery(roles)}`,
          { method: 'GET' },
        ),
      ),
    getWorkflowBoard: (workflowId) =>
      withRefresh(() =>
        requestData<DashboardWorkflowBoardResponse>(`/api/v1/workflows/${workflowId}/board`, {
          method: 'GET',
        }),
      ),
    listWorkflowStages: (workflowId) =>
      withRefresh(() =>
        requestData<DashboardWorkflowStageRecord[]>(`/api/v1/workflows/${workflowId}/stages`, {
          method: 'GET',
        }),
      ),
    listWorkflowWorkItems: (workflowId) =>
      withRefresh(() =>
        requestData<DashboardWorkflowWorkItemRecord[]>(
          `/api/v1/workflows/${workflowId}/work-items`,
          {
            method: 'GET',
          },
        ),
      ),
    getWorkflowWorkItem: (workflowId, workItemId) =>
      withRefresh(() =>
        requestData<DashboardWorkflowWorkItemRecord>(
          `/api/v1/workflows/${workflowId}/work-items/${workItemId}`,
          {
            method: 'GET',
          },
        ),
      ),
    listWorkflowWorkItemTasks: (workflowId, workItemId) =>
      withRefresh(() =>
        requestData<Record<string, unknown>[]>(
          `/api/v1/workflows/${workflowId}/work-items/${workItemId}/tasks`,
          {
            method: 'GET',
          },
        ),
      ),
    listWorkflowWorkItemEvents: (workflowId, workItemId, limit = 100) =>
      withRefresh(() =>
        requestData<DashboardEventRecord[]>(
          `/api/v1/workflows/${workflowId}/work-items/${workItemId}/events?limit=${limit}`,
          {
            method: 'GET',
          },
        ),
      ),
    listWorkflowWorkItemHandoffs: (workflowId, workItemId) =>
      withRefresh(() =>
        requestData<DashboardTaskHandoffRecord[]>(
          `/api/v1/workflows/${workflowId}/work-items/${workItemId}/handoffs`,
          {
            method: 'GET',
          },
        ),
      ),
    getLatestWorkflowWorkItemHandoff: (workflowId, workItemId) =>
      withRefresh(() =>
        requestData<DashboardTaskHandoffRecord | null>(
          `/api/v1/workflows/${workflowId}/work-items/${workItemId}/handoffs/latest`,
          {
            method: 'GET',
          },
        ),
      ),
    getWorkflowWorkItemMemory: (workflowId, workItemId) =>
      withRefresh(() =>
        requestData<{ entries: DashboardWorkItemMemoryEntry[] }>(
          `/api/v1/workflows/${workflowId}/work-items/${workItemId}/memory`,
          {
            method: 'GET',
          },
        ),
      ),
    getWorkflowWorkItemMemoryHistory: (workflowId, workItemId, limit = 100) =>
      withRefresh(() =>
        requestData<{ history: DashboardWorkItemMemoryHistoryEntry[] }>(
          `/api/v1/workflows/${workflowId}/work-items/${workItemId}/memory/history?limit=${limit}`,
          {
            method: 'GET',
          },
        ),
      ),
    listWorkflowActivations: (workflowId) =>
      withRefresh(() =>
        requestData<DashboardWorkflowActivationRecord[]>(
          `/api/v1/workflows/${workflowId}/activations`,
          { method: 'GET' },
        ),
      ),
    enqueueWorkflowActivation: (workflowId, payload) =>
      withRefresh(() =>
        requestData<DashboardWorkflowActivationRecord>(
          `/api/v1/workflows/${workflowId}/activations`,
          {
            method: 'POST',
            body: buildRequestBodyWithRequestId({
              ...payload,
              event_type:
                typeof payload.event_type === 'string' && payload.event_type.trim().length > 0
                  ? payload.event_type
                  : defaultManualWorkflowActivationEventType,
            }),
          },
        ),
      ),
    listWorkflowEvents: (workflowId, filters) =>
      withRefresh(async () =>
        normalizeEventPage(
          await requestJson<{
            data: DashboardEventRecord[];
            meta?: { has_more?: boolean; next_after?: string | number | null };
          }>(`/api/v1/workflows/${workflowId}/events${buildQueryString(filters)}`, {
            method: 'GET',
          }),
        ),
      ),
    listWorkflowDocuments: (workflowId) =>
      withRefresh(() =>
        requestData<DashboardResolvedDocumentReference[]>(
          `/api/v1/workflows/${workflowId}/documents`,
          { method: 'GET' },
        ),
      ),
    createWorkflowDocument: (workflowId, payload) =>
      withRefresh(() =>
        requestData<DashboardResolvedDocumentReference>(
          `/api/v1/workflows/${workflowId}/documents`,
          {
            method: 'POST',
            body: buildRequestBodyWithRequestId(payload as unknown as Record<string, unknown>),
          },
        ),
      ),
    updateWorkflowDocument: (workflowId, logicalName, payload) =>
      withRefresh(() =>
        requestData<DashboardResolvedDocumentReference>(
          `/api/v1/workflows/${workflowId}/documents/${encodeURIComponent(logicalName)}`,
          {
            method: 'PATCH',
            body: buildRequestBodyWithRequestId(payload as Record<string, unknown>),
          },
        ),
      ),
    deleteWorkflowDocument: (workflowId, logicalName) =>
      withRefresh(() =>
        requestJson<Record<string, never>>(
          `/api/v1/workflows/${workflowId}/documents/${encodeURIComponent(logicalName)}${buildQueryString({ request_id: createRequestId() })}`,
          {
            method: 'DELETE',
          },
        ).then(() => undefined),
      ),
    listPlaybooks: () =>
      withRefresh(async () => ({
        data: (await client.listPlaybooks()) as DashboardPlaybookRecord[],
      })),
    getPlaybook: (playbookId) =>
      withRefresh(() => client.getPlaybook(playbookId) as Promise<DashboardPlaybookRecord>),
    createPlaybook: (payload) =>
      withRefresh(
        () => client.createPlaybook(payload as never) as Promise<DashboardPlaybookRecord>,
      ),
    updatePlaybook: (playbookId, payload) =>
      withRefresh(
        () =>
          client.updatePlaybook(playbookId, payload as never) as Promise<DashboardPlaybookRecord>,
      ),
    archivePlaybook: (playbookId) =>
      withRefresh(() => client.archivePlaybook(playbookId) as Promise<DashboardPlaybookRecord>),
    restorePlaybook: (playbookId) =>
      withRefresh(() => client.restorePlaybook(playbookId) as Promise<DashboardPlaybookRecord>),
    deletePlaybook: (playbookId) =>
      withRefresh(() => client.deletePlaybook(playbookId).then(() => undefined)),
    listLlmProviders: () =>
      withRefresh(() =>
        requestData<DashboardLlmProviderRecord[]>('/api/v1/config/llm/providers', {
          method: 'GET',
        }),
      ),
    listLlmModels: () =>
      withRefresh(() =>
        requestData<DashboardLlmModelRecord[]>('/api/v1/config/llm/models', {
          method: 'GET',
        }),
      ),
    createWorkflow: (payload) =>
      withRefresh(
        () => client.createWorkflow(payload as never) as Promise<DashboardWorkflowRecord>,
      ),
    previewEffectiveModels: (payload) =>
      withRefresh(() =>
        requestData<{
          roles: string[];
          workspace_model_overrides: Record<string, DashboardRoleModelOverride>;
          workflow_model_overrides: Record<string, DashboardRoleModelOverride>;
          effective_models: Record<string, DashboardEffectiveModelResolution>;
        }>('/api/v1/config/llm/resolve-preview', {
          method: 'POST',
          body: payload as Record<string, unknown>,
        }),
      ),
    createWorkflowWorkItem: (workflowId, payload) =>
      withRefresh(() =>
        requestData<DashboardWorkflowWorkItemRecord>(`/api/v1/workflows/${workflowId}/work-items`, {
          body: payload as Record<string, unknown>,
        }),
      ),
    updateWorkflowWorkItem: (workflowId, workItemId, payload) =>
      withRefresh(() =>
        requestData<DashboardWorkflowWorkItemRecord>(
          `/api/v1/workflows/${workflowId}/work-items/${workItemId}`,
          {
            method: 'PATCH',
            body: payload as Record<string, unknown>,
          },
        ),
      ),
    retryWorkflowWorkItem: (workflowId, workItemId, payload = {}) =>
      withRefresh(() => requestWorkflowWorkItemAction(workflowId, workItemId, 'retry', payload)),
    skipWorkflowWorkItem: (workflowId, workItemId, payload) =>
      withRefresh(() => requestWorkflowWorkItemAction(workflowId, workItemId, 'skip', payload)),
    reassignWorkflowWorkItemTask: (workflowId, workItemId, taskId, payload) =>
      withRefresh(() =>
        requestWorkflowWorkItemTaskAction(
          workflowId,
          workItemId,
          taskId,
          'reassign',
          payload,
        ),
      ),
    approveWorkflowWorkItemTask: (workflowId, workItemId, taskId) =>
      withRefresh(() =>
        requestWorkflowWorkItemTaskAction(workflowId, workItemId, taskId, 'approve', {}),
      ),
    approveWorkflowWorkItemTaskOutput: (workflowId, workItemId, taskId) =>
      withRefresh(() =>
        requestWorkflowWorkItemTaskAction(workflowId, workItemId, taskId, 'approve-output', {}),
      ),
    rejectWorkflowWorkItemTask: (workflowId, workItemId, taskId, payload) =>
      withRefresh(() =>
        requestWorkflowWorkItemTaskAction(workflowId, workItemId, taskId, 'reject', payload),
      ),
    requestWorkflowWorkItemTaskChanges: (workflowId, workItemId, taskId, payload) =>
      withRefresh(() =>
        requestWorkflowWorkItemTaskAction(
          workflowId,
          workItemId,
          taskId,
          'request-changes',
          payload,
        ),
      ),
    retryWorkflowWorkItemTask: (workflowId, workItemId, taskId, payload = {}) =>
      withRefresh(() =>
        requestWorkflowWorkItemTaskAction(workflowId, workItemId, taskId, 'retry', payload),
      ),
    skipWorkflowWorkItemTask: (workflowId, workItemId, taskId, payload) =>
      withRefresh(() =>
        requestWorkflowWorkItemTaskAction(workflowId, workItemId, taskId, 'skip', payload),
      ),
    resolveWorkflowWorkItemTaskEscalation: (workflowId, workItemId, taskId, payload) =>
      withRefresh(() =>
        requestWorkflowWorkItemTaskAction(
          workflowId,
          workItemId,
          taskId,
          'resolve-escalation',
          payload,
        ),
      ),
    cancelWorkflowWorkItemTask: (workflowId, workItemId, taskId) =>
      withRefresh(() =>
        requestWorkflowWorkItemTaskAction(workflowId, workItemId, taskId, 'cancel', {}),
      ),
    overrideWorkflowWorkItemTaskOutput: (workflowId, workItemId, taskId, payload) =>
      withRefresh(() =>
        requestWorkflowWorkItemTaskAction(
          workflowId,
          workItemId,
          taskId,
          'output-override',
          payload as Record<string, unknown>,
        ),
      ),
    cancelWorkflow: (workflowId) =>
      withRefresh(() => requestWorkflowControlAction(`/api/v1/workflows/${workflowId}/cancel`)),
    chainWorkflow: (workflowId, payload) =>
      withRefresh(() =>
        requestJson(`/api/v1/workflows/${workflowId}/chain`, {
          body: payload as unknown as Record<string, unknown>,
        }),
      ),
    listTasks: (filters) => withRefresh(() => client.listTasks(filters)),
    getTask: (id) => withRefresh(() => client.getTask(id)),
    listTaskArtifacts: (taskId) =>
      withRefresh(() =>
        requestData<DashboardTaskArtifactRecord[]>(`/api/v1/tasks/${taskId}/artifacts`, {
          method: 'GET',
        }),
      ),
    uploadTaskArtifact: (taskId, payload) =>
      withRefresh(() =>
        requestData<DashboardTaskArtifactRecord>(`/api/v1/tasks/${taskId}/artifacts`, {
          method: 'POST',
          body: payload as unknown as Record<string, unknown>,
        }),
      ),
    readTaskArtifactContent: (taskId, artifactId) =>
      withRefresh(async () => {
        const response = await requestBinary(`/api/v1/tasks/${taskId}/artifacts/${artifactId}`, {
          method: 'GET',
        });
        return {
          content_type: response.headers.get('content-type') ?? 'application/octet-stream',
          content_text: await response.text(),
          file_name: readContentDispositionFileName(response.headers.get('content-disposition')),
          size_bytes: Number(response.headers.get('content-length') ?? '0'),
        };
      }),
    downloadTaskArtifact: (taskId, artifactId) =>
      withRefresh(async () => {
        const response = await requestBinary(`/api/v1/tasks/${taskId}/artifacts/${artifactId}`, {
          method: 'GET',
        });
        return {
          blob: await response.blob(),
          content_type: response.headers.get('content-type') ?? 'application/octet-stream',
          file_name: readContentDispositionFileName(response.headers.get('content-disposition')),
          size_bytes: Number(response.headers.get('content-length') ?? '0'),
        };
      }),
    deleteTaskArtifact: (taskId, artifactId) =>
      withRefresh(() =>
        requestJson<Record<string, never>>(`/api/v1/tasks/${taskId}/artifacts/${artifactId}`, {
          method: 'DELETE',
        }).then(() => undefined),
      ),
    listWorkers: () => withRefresh(() => client.listWorkers()),
    listAgents: () => withRefresh(() => client.listAgents() as Promise<DashboardAgentRecord[]>),
    getApprovalQueue: () =>
      withRefresh(() =>
        requestData<DashboardApprovalQueueResponse>('/api/v1/approvals', {
          method: 'GET',
        }),
      ),
    approveTask: (taskId) => withRefresh(() => requestJson(`/api/v1/tasks/${taskId}/approve`)),
    approveTaskOutput: (taskId) =>
      withRefresh(() => requestJson(`/api/v1/tasks/${taskId}/approve-output`)),
    retryTask: (taskId, payload = {}) =>
      withRefresh(() => requestJson(`/api/v1/tasks/${taskId}/retry`, { body: payload })),
    cancelTask: (taskId) => withRefresh(() => requestJson(`/api/v1/tasks/${taskId}/cancel`)),
    rejectTask: (taskId, payload) =>
      withRefresh(() => requestJson(`/api/v1/tasks/${taskId}/reject`, { body: payload })),
    requestTaskChanges: (taskId, payload) =>
      withRefresh(() => requestJson(`/api/v1/tasks/${taskId}/request-changes`, { body: payload })),
    skipTask: (taskId, payload) =>
      withRefresh(() => requestJson(`/api/v1/tasks/${taskId}/skip`, { body: payload })),
    reassignTask: (taskId, payload) =>
      withRefresh(() => requestJson(`/api/v1/tasks/${taskId}/reassign`, { body: payload })),
    escalateTask: (taskId, payload) =>
      withRefresh(() => requestJson(`/api/v1/tasks/${taskId}/escalate`, { body: payload })),
    resolveEscalation: (taskId, payload) =>
      withRefresh(() =>
        requestJson(`/api/v1/tasks/${taskId}/resolve-escalation`, { body: payload }),
      ),
    overrideTaskOutput: (taskId, payload) =>
      withRefresh(() => requestJson(`/api/v1/tasks/${taskId}/output-override`, { body: payload })),
    pauseWorkflow: (workflowId) =>
      withRefresh(() => requestWorkflowControlAction(`/api/v1/workflows/${workflowId}/pause`)),
    resumeWorkflow: (workflowId) =>
      withRefresh(() => requestWorkflowControlAction(`/api/v1/workflows/${workflowId}/resume`)),
    getResolvedWorkflowConfig: (workflowId, showLayers = false) =>
      withRefresh(() =>
        requestData<DashboardResolvedConfigResponse>(
          `/api/v1/workflows/${workflowId}/config/resolved${showLayers ? '?show_layers=true' : ''}`,
          { method: 'GET' },
        ),
      ),
    getWorkspaceTimeline: (workspaceId) =>
      withRefresh(() =>
        requestData<DashboardWorkspaceTimelineEntry[]>(`/api/v1/workspaces/${workspaceId}/timeline`, {
          method: 'GET',
        }),
      ),
    listWorkspaceArtifacts: (workspaceId, filters) =>
      withRefresh(() =>
        requestJson<DashboardWorkspaceArtifactResponse>(
          `/api/v1/workspaces/${workspaceId}/artifacts${buildQueryString(filters)}`,
          {
            method: 'GET',
          },
        ),
      ),
    listWorkspaceArtifactFiles: (workspaceId) =>
      withRefresh(() =>
        requestData<DashboardWorkspaceArtifactFileRecord[]>(`/api/v1/workspaces/${workspaceId}/files`, {
          method: 'GET',
        }),
      ),
    downloadWorkspaceArtifactFile: (workspaceId, fileId) =>
      withRefresh(async () => {
        const response = await requestBinary(
          `/api/v1/workspaces/${workspaceId}/files/${fileId}/content`,
          {
            method: 'GET',
          },
        );
        return {
          blob: await response.blob(),
          content_type: response.headers.get('content-type') ?? 'application/octet-stream',
          file_name: readContentDispositionFileName(response.headers.get('content-disposition')),
          size_bytes: Number(response.headers.get('content-length') ?? '0'),
        };
      }),
    uploadWorkspaceArtifactFiles: (workspaceId, payload) =>
      withRefresh(() =>
        requestData<DashboardWorkspaceArtifactFileRecord[]>(
          `/api/v1/workspaces/${workspaceId}/files/batch`,
          {
            body: { files: payload as unknown as Record<string, unknown>[] },
          },
        ),
      ),
    deleteWorkspaceArtifactFile: (workspaceId, fileId) =>
      withRefresh(async () => {
        await requestJson(`/api/v1/workspaces/${workspaceId}/files/${fileId}`, {
          method: 'DELETE',
          allowNoContent: true,
        });
      }),
    createPlanningWorkflow: (workspaceId, payload) =>
      withRefresh(() =>
        requestJson(`/api/v1/workspaces/${workspaceId}/planning-workflow`, {
          body: payload,
        }),
      ),
    listRoleDefinitions: () =>
      withRefresh(() =>
        requestData<
          Array<{ id: string; name: string; description: string | null; is_active: boolean }>
        >('/api/v1/config/roles', {
          method: 'GET',
        }),
      ),
    listToolTags: () =>
      withRefresh(() =>
        requestData<DashboardToolTagRecord[]>('/api/v1/tools', {
          method: 'GET',
        }),
      ),
    createToolTag: (payload) =>
      withRefresh(() =>
        requestData<DashboardToolTagRecord>('/api/v1/tools', {
          body: payload as unknown as Record<string, unknown>,
        }),
      ),
    updateToolTag: (toolId, payload) =>
      withRefresh(() =>
        requestData<DashboardToolTagRecord>(`/api/v1/tools/${encodeURIComponent(toolId)}`, {
          method: 'PATCH',
          body: payload as unknown as Record<string, unknown>,
        }),
      ),
    deleteToolTag: (toolId) =>
      withRefresh(async () => {
        await requestJson(`/api/v1/tools/${encodeURIComponent(toolId)}`, {
          method: 'DELETE',
        });
      }),
    listWebhooks: () =>
      withRefresh(() =>
        requestData<DashboardOutboundWebhookRecord[]>('/api/v1/webhooks', {
          method: 'GET',
        }),
      ),
    createWebhook: (payload) =>
      withRefresh(() =>
        requestData<DashboardOutboundWebhookRecord>('/api/v1/webhooks', {
          body: payload as unknown as Record<string, unknown>,
        }),
      ),
    updateWebhook: (id, payload) =>
      withRefresh(() =>
        requestData<DashboardOutboundWebhookRecord>(`/api/v1/webhooks/${id}`, {
          method: 'PATCH',
          body: payload as unknown as Record<string, unknown>,
        }),
      ),
    deleteWebhook: (id) =>
      withRefresh(async () => {
        await requestJson(`/api/v1/webhooks/${id}`, { method: 'DELETE' });
      }),
    listRuntimeDefaults: () =>
      withRefresh(() =>
        requestData<DashboardRuntimeDefaultRecord[]>('/api/v1/config/runtime-defaults', {
          method: 'GET',
        }),
      ),
    upsertRuntimeDefault: (input) =>
      withRefresh(async () => {
        await requestJson('/api/v1/config/runtime-defaults', {
          body: input as unknown as Record<string, unknown>,
        });
      }),
    deleteRuntimeDefault: (id) =>
      withRefresh(async () => {
        await requestJson(`/api/v1/config/runtime-defaults/${id}`, {
          method: 'DELETE',
        });
      }),
    saveRoleDefinition: (roleId, payload) =>
      withRefresh(() =>
        requestData<{
          id: string;
          name: string;
          description: string | null;
          is_active: boolean;
        }>(roleId ? `/api/v1/config/roles/${roleId}` : '/api/v1/config/roles', {
          method: roleId ? 'PUT' : 'POST',
          body: payload,
        }),
      ),
    deleteRoleDefinition: (roleId) =>
      withRefresh(async () => {
        await requestJson(`/api/v1/config/roles/${roleId}`, {
          method: 'DELETE',
          allowNoContent: true,
        });
      }),
    getLlmSystemDefault: () =>
      withRefresh(() =>
        requestData<DashboardLlmSystemDefaultRecord>('/api/v1/config/llm/system-default', {
          method: 'GET',
        }),
      ),
    updateLlmSystemDefault: (payload) =>
      withRefresh(async () => {
        await requestJson('/api/v1/config/llm/system-default', {
          method: 'PUT',
          body: payload as unknown as Record<string, unknown>,
        });
      }),
    listLlmAssignments: () =>
      withRefresh(() =>
        requestData<DashboardLlmAssignmentRecord[]>('/api/v1/config/llm/assignments', {
          method: 'GET',
        }),
      ),
    updateLlmAssignment: (roleName, payload) =>
      withRefresh(async () => {
        await requestJson(`/api/v1/config/llm/assignments/${encodeURIComponent(roleName)}`, {
          method: 'PUT',
          body: payload as unknown as Record<string, unknown>,
        });
      }),
    createLlmProvider: (payload) =>
      withRefresh(() =>
        requestData<DashboardLlmProviderRecord>('/api/v1/config/llm/providers', {
          body: payload as unknown as Record<string, unknown>,
        }),
      ),
    deleteLlmProvider: (providerId) =>
      withRefresh(async () => {
        await requestJson(`/api/v1/config/llm/providers/${providerId}`, {
          method: 'DELETE',
          allowNoContent: true,
        });
      }),
    discoverLlmModels: (providerId) =>
      withRefresh(() =>
        requestData<unknown[]>(`/api/v1/config/llm/providers/${providerId}/discover`, {
          method: 'POST',
        }),
      ),
    updateLlmModel: (modelId, payload) =>
      withRefresh(async () => {
        await requestJson(`/api/v1/config/llm/models/${modelId}`, {
          method: 'PUT',
          body: payload,
        });
      }),
    listOAuthProfiles: () =>
      withRefresh(() =>
        requestData<DashboardOAuthProfileRecord[]>('/api/v1/config/oauth/profiles', {
          method: 'GET',
        }),
      ),
    initiateOAuthFlow: (profileId) =>
      withRefresh(() =>
        requestData<{ authorizeUrl: string }>('/api/v1/config/oauth/authorize', {
          body: { profileId },
        }),
      ),
    getOAuthProviderStatus: (providerId) =>
      withRefresh(() =>
        requestData<DashboardOAuthStatusRecord>(
          `/api/v1/config/oauth/providers/${providerId}/status`,
          { method: 'GET' },
        ),
      ),
    disconnectOAuthProvider: (providerId) =>
      withRefresh(async () => {
        await requestJson(`/api/v1/config/oauth/providers/${providerId}/disconnect`, {
          method: 'POST',
        });
      }),
    listIntegrations: () =>
      withRefresh(() =>
        requestData<DashboardIntegrationRecord[]>('/api/v1/integrations', {
          method: 'GET',
        }),
      ),
    getCostSummary: () =>
      withRefresh(() =>
        requestData<DashboardCostSummaryRecord>('/api/v1/metering/summary', {
          method: 'GET',
        }),
      ),
    createIntegration: (payload) =>
      withRefresh(() =>
        requestData<DashboardIntegrationRecord>('/api/v1/integrations', {
          body: payload as Record<string, unknown>,
        }),
      ),
    updateIntegration: (integrationId, payload) =>
      withRefresh(() =>
        requestData<DashboardIntegrationRecord>(`/api/v1/integrations/${integrationId}`, {
          method: 'PATCH',
          body: payload as Record<string, unknown>,
        }),
      ),
    deleteIntegration: (integrationId) =>
      withRefresh(async () => {
        await requestJson(`/api/v1/integrations/${integrationId}`, { method: 'DELETE' });
      }),
    getRetentionPolicy: () =>
      withRefresh(() =>
        requestData<DashboardGovernanceRetentionPolicy>('/api/v1/governance/retention-policy', {
          method: 'GET',
        }),
      ),
    updateRetentionPolicy: (payload) =>
      withRefresh(() =>
        requestData<DashboardGovernanceRetentionPolicy>('/api/v1/governance/retention-policy', {
          method: 'PUT',
          body: payload as Record<string, unknown>,
        }),
      ),
    getLoggingConfig: () =>
      withRefresh(() =>
        requestData<DashboardLoggingConfig>('/api/v1/governance/logging', {
          method: 'GET',
        }),
      ),
    updateLoggingConfig: (payload) =>
      withRefresh(() =>
        requestData<DashboardLoggingConfig>('/api/v1/governance/logging', {
          method: 'PUT',
          body: payload as unknown as Record<string, unknown>,
        }),
      ),
    listEvents: (filters) =>
      withRefresh(async () =>
        normalizeEventPage(
          await requestJson<{
            data: DashboardEventRecord[];
            meta?: { has_more?: boolean; next_after?: string | number | null };
          }>(`/api/v1/events${buildQueryString(filters)}`, {
            method: 'GET',
          }),
        ),
      ),
    listApiKeys: () =>
      withRefresh(async () => {
        const response = await requestJson<{ data: DashboardApiKeyRecord[] }>('/api/v1/api-keys', {
          method: 'GET',
        });
        return response.data;
      }),
    createApiKey: (payload) =>
      withRefresh(async () => {
        const response = await requestJson<{
          data: { api_key: string; key_prefix: string };
        }>('/api/v1/api-keys', { body: payload });
        return response.data;
      }),
    revokeApiKey: (id) =>
      withRefresh(() => requestJson(`/api/v1/api-keys/${id}`, { method: 'DELETE' })),
    search: (query) =>
      withRefresh(async () => {
        const normalizedQuery = query.trim().toLowerCase();
        if (normalizedQuery.length < 2) {
          return [];
        }

        const [workflows, tasks, workers, agents, workspaces, playbooks] = await Promise.allSettled([
          client.listWorkflows({ per_page: 50 }),
          client.listTasks({ per_page: 50 }),
          client.listWorkers(),
          client.listAgents(),
          client.listWorkspaces({ per_page: 50 }),
          client.listPlaybooks(),
        ]);

        return buildSearchResults(normalizedQuery, {
          workflows: extractListResult(workflows),
          tasks: extractListResult(tasks),
          workers: extractDataResult(workers),
          agents: extractDataResult(agents),
          workspaces: extractListResult(workspaces),
          playbooks: extractDataResult(playbooks),
        });
      }),
    fetchFleetStatus: () =>
      withRefresh(() =>
        requestData<FleetStatusResponse>('/api/v1/fleet/status', {
          method: 'GET',
        }),
      ),
    fetchFleetEvents: (filters) =>
      withRefresh(async () => {
        const response = await requestJson<{
          data?: { events?: FleetEventRecord[]; total?: number };
        }>(`/api/v1/fleet/events${buildQueryString(filters)}`, { method: 'GET' });
        return {
          data: response.data?.events ?? [],
          total: response.data?.total ?? 0,
        };
      }),
    fetchFleetWorkers: () =>
      withRefresh(() =>
        requestData<FleetWorkerRecord[]>('/api/v1/fleet/workers', {
          method: 'GET',
        }),
      ),
    createFleetWorker: (payload) =>
      withRefresh(() =>
        requestData<FleetWorkerRecord>('/api/v1/fleet/workers', {
          method: 'POST',
          body: payload as Record<string, unknown>,
        }),
      ),
    updateFleetWorker: (workerId, payload) =>
      withRefresh(() =>
        requestData<FleetWorkerRecord>(`/api/v1/fleet/workers/${workerId}`, {
          method: 'PATCH',
          body: payload as Record<string, unknown>,
        }),
      ),
    restartFleetWorker: (workerId) =>
      withRefresh(() =>
        requestData<unknown>(`/api/v1/fleet/workers/${workerId}/restart`, {
          method: 'POST',
        }),
      ),
    drainFleetWorker: (workerId) =>
      withRefresh(() =>
        requestData<unknown>(`/api/v1/fleet/workers/${workerId}/drain`, {
          method: 'POST',
        }),
      ),
    deleteFleetWorker: (workerId) =>
      withRefresh(() =>
        requestJson<Record<string, never>>(`/api/v1/fleet/workers/${workerId}`, {
          method: 'DELETE',
        }).then(() => undefined),
      ),
    fetchFleetContainers: () =>
      withRefresh(() =>
        requestData<FleetContainerRecord[]>('/api/v1/fleet/containers', {
          method: 'GET',
        }),
      ),
    fetchFleetImages: () =>
      withRefresh(() =>
        requestData<FleetImageRecord[]>('/api/v1/fleet/images', {
          method: 'GET',
        }),
      ),
    pruneFleetContainers: () =>
      withRefresh(() =>
        requestData<{ removed: number }>('/api/v1/fleet/containers/prune', {
          method: 'POST',
        }),
      ),
    pullFleetImage: (payload) =>
      withRefresh(() =>
        requestData<{ repository: string; tag: string }>('/api/v1/fleet/images/pull', {
          body: payload as unknown as Record<string, unknown>,
        }),
      ),
    fetchQueueDepth: (playbookId) =>
      withRefresh(() => {
        const path = playbookId
          ? `/api/v1/tasks/queue-depth?playbook_id=${encodeURIComponent(playbookId)}`
          : '/api/v1/tasks/queue-depth';
        return requestData<QueueDepthResponse>(path, { method: 'GET' });
      }),
    getMetrics: () =>
      withRefresh(async () => {
        const activeSession = readSession();
        const headers = activeSession?.accessToken
          ? {
              Authorization: `Bearer ${activeSession.accessToken}`,
            }
          : undefined;

        const response = await requestFetch(`${baseUrl}/metrics`, {
          headers,
          credentials: 'include',
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        return response.text();
      }),
    getCustomizationStatus: () =>
      withRefresh(() =>
        requestData<DashboardCustomizationStatusResponse>('/api/v1/runtime/customizations/status', {
          method: 'GET',
        }),
      ),
    validateCustomization: (payload) =>
      withRefresh(() =>
        requestData<DashboardCustomizationValidateResponse>(
          '/api/v1/runtime/customizations/validate',
          { body: payload },
        ),
      ),
    createCustomizationBuild: (payload) =>
      withRefresh(() =>
        requestData<DashboardCustomizationBuildResponse>('/api/v1/runtime/customizations/builds', {
          body: payload,
        }),
      ),
    getCustomizationBuild: (id) =>
      withRefresh(() =>
        requestData<DashboardCustomizationBuildResponse>(
          `/api/v1/runtime/customizations/builds/${id}`,
          { method: 'GET' },
        ),
      ),
    linkCustomizationBuild: (payload) =>
      withRefresh(() =>
        requestData<DashboardCustomizationLinkResponse>('/api/v1/runtime/customizations/links', {
          body: payload,
        }),
      ),
    rollbackCustomizationBuild: (payload) =>
      withRefresh(() =>
        requestData<DashboardCustomizationRollbackResponse>(
          '/api/v1/runtime/customizations/rollback',
          { body: payload },
        ),
      ),
    reconstructCustomization: () =>
      withRefresh(() =>
        requestData<DashboardCustomizationInspectResponse>(
          '/api/v1/runtime/customizations/reconstruct',
          { body: {} },
        ),
      ),
    exportCustomization: (payload) =>
      withRefresh(() =>
        requestData<DashboardCustomizationExportResponse>(
          '/api/v1/runtime/customizations/reconstruct/export',
          { body: payload },
        ),
      ),
    queryLogs: (filters) =>
      withRefresh(() =>
        requestJson<LogQueryResponse>(`/api/v1/logs${buildQueryString(filters)}`, {
          method: 'GET',
        }),
      ),
    getLog: (logId) =>
      withRefresh(() =>
        requestJson<{ data: LogEntry }>(`/api/v1/logs/${encodeURIComponent(String(logId))}`, {
          method: 'GET',
        }),
      ),
    getLogStats: (filters) =>
      withRefresh(() =>
        requestJson<LogStatsResponse>(`/api/v1/logs/stats${buildQueryString(filters)}`, {
          method: 'GET',
        }),
      ),
    getLogOperations: (filters) =>
      withRefresh(() =>
        requestJson<{ data: LogOperationRecord[] }>(
          `/api/v1/logs/operations${buildQueryString(filters)}`,
          { method: 'GET' },
        ),
      ),
    getLogRoles: (filters) =>
      withRefresh(() =>
        requestJson<{ data: LogRoleRecord[] }>(`/api/v1/logs/roles${buildQueryString(filters)}`, {
          method: 'GET',
        }),
      ),
    getLogActors: (filters) =>
      withRefresh(() =>
        requestJson<{ data: LogActorRecord[] }>(`/api/v1/logs/actors${buildQueryString(filters)}`, {
          method: 'GET',
        }),
      ),
    exportLogs: (filters) =>
      withRefresh(async () => {
        const res = await requestFetch(
          `${baseUrl}/api/v1/logs/export${buildQueryString(filters)}`,
          {
            headers: { Authorization: `Bearer ${readSession()?.accessToken ?? ''}` },
          },
        );
        if (!res.ok) throw new Error(`Export failed: ${res.status}`);
        return res.blob();
      }),
    deleteWorkspace: (workspaceId) =>
      withRefresh(async () => {
        await requestJson(`/api/v1/workspaces/${workspaceId}`, { method: 'DELETE' });
      }),
    askConfigAssistant: (question) =>
      withRefresh(async () => {
        const response = await requestJson<{
          data?: DashboardConfigAssistantResponse;
          reply?: string;
          suggestions?: DashboardConfigAssistantResponse['suggestions'];
        }>('/api/v1/config/assistant', {
          body: { question },
        });
        return (response.data ?? response) as DashboardConfigAssistantResponse;
      }),
  };
}

function buildQueryString(filters?: Record<string, string>): string {
  if (!filters) {
    return '';
  }

  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) {
      params.set(key, value);
    }
  });

  const rendered = params.toString();
  return rendered.length > 0 ? `?${rendered}` : '';
}

function buildRequestBodyWithRequestId(body: Record<string, unknown>): Record<string, unknown> {
  const requestId =
    typeof body.request_id === 'string' && body.request_id.trim().length > 0
      ? body.request_id
      : createRequestId();
  return {
    ...body,
    request_id: requestId,
  };
}

function createRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function buildSearchResults(
  normalizedQuery: string,
  collections: {
    workflows: NamedRecord[];
    tasks: NamedRecord[];
    workers: NamedRecord[];
    agents: NamedRecord[];
    workspaces: NamedRecord[];
    playbooks: NamedRecord[];
  },
): DashboardSearchResult[] {
  const workflowMatches = filterRecords(collections.workflows, normalizedQuery).map((item) => ({
    type: 'workflow' as const,
    id: item.id,
    label: item.name ?? item.id,
    subtitle: item.state ?? 'workflow',
    href: `/work/boards/${item.id}`,
  }));

  const taskMatches = filterRecords(collections.tasks, normalizedQuery).map((item) => ({
    type: 'task' as const,
    id: item.id,
    label: item.title ?? item.name ?? item.id,
    subtitle: item.state ?? 'task',
    href: `/work/tasks/${item.id}`,
  }));

  const workerMatches = filterRecords(collections.workers, normalizedQuery).map((item) => ({
    type: 'worker' as const,
    id: item.id,
    label: item.name ?? item.id,
    subtitle: item.status ?? 'worker',
    href: '/fleet/workers',
  }));

  const agentMatches = filterRecords(collections.agents, normalizedQuery).map((item) => ({
    type: 'agent' as const,
    id: item.id,
    label: item.name ?? item.id,
    subtitle: item.status ?? 'agent',
    href: '/fleet/agents',
  }));

  const workspaceMatches = filterRecords(collections.workspaces, normalizedQuery).map((item) => ({
    type: 'workspace' as const,
    id: item.id,
    label: item.name ?? item.id,
    subtitle: item.status ?? 'workspace',
    href: `/workspaces/${item.id}`,
  }));

  const playbookMatches = filterRecords(collections.playbooks, normalizedQuery).map((item) => ({
    type: 'playbook' as const,
    id: item.id,
    label: item.name ?? item.id,
    subtitle: item.status ?? 'playbook',
    href: `/config/playbooks/${item.id}`,
  }));

  return [
    ...workflowMatches,
    ...taskMatches,
    ...workspaceMatches,
    ...playbookMatches,
    ...workerMatches,
    ...agentMatches,
  ].slice(0, 12);
}

function filterRecords(records: NamedRecord[], query: string): NamedRecord[] {
  return records.filter((record) => {
    const haystack = `${record.id} ${record.name ?? ''} ${record.title ?? ''}`.toLowerCase();
    return haystack.includes(query);
  });
}

function extractListResult(result: PromiseSettledResult<unknown>): NamedRecord[] {
  if (result.status !== 'fulfilled') {
    return [];
  }

  const value = result.value as { data?: unknown };
  return Array.isArray(value.data) ? (value.data as NamedRecord[]) : [];
}

function extractDataResult(result: PromiseSettledResult<unknown>): NamedRecord[] {
  if (result.status !== 'fulfilled') {
    return [];
  }

  const value = result.value as { data?: unknown } | unknown[];
  if (Array.isArray(value)) {
    return value as NamedRecord[];
  }

  if (value && typeof value === 'object' && Array.isArray((value as { data?: unknown }).data)) {
    return (value as { data: NamedRecord[] }).data;
  }

  return [];
}

function buildRolesQuery(roles?: string[]): string {
  if (!roles || roles.length === 0) {
    return '';
  }
  const filtered = roles.map((role) => role.trim()).filter(Boolean);
  if (filtered.length === 0) {
    return '';
  }
  return `?roles=${encodeURIComponent(filtered.join(','))}`;
}

export const dashboardApi = createDashboardApi();
