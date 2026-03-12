export type ApiScope = 'agent' | 'worker' | 'admin';

export type TaskPriority = 'critical' | 'high' | 'normal' | 'low';
export type TaskState =
  | 'pending'
  | 'ready'
  | 'claimed'
  | 'in_progress'
  | 'escalated'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'awaiting_approval'
  | 'output_pending_review';

export interface ApiListResponse<T> {
  data: T[];
  pagination: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
}

export interface ApiDataResponse<T> {
  data: T;
}

export interface AuthTokenResponse {
  token: string;
  scope: ApiScope;
  tenant_id: string;
}

export interface Agent {
  id: string;
  tenant_id: string;
  worker_id: string | null;
  name: string;
  status: string;
  capabilities: string[];
  profile: Record<string, unknown>;
  current_task_id: string | null;
  heartbeat_interval_seconds: number;
  last_heartbeat_at: string;
  created_at: string;
  updated_at: string;
}

export interface Worker {
  id: string;
  tenant_id: string;
  name: string;
  runtime_type: string;
  connection_mode: string;
  status: string;
  capabilities: string[];
  host_info: Record<string, unknown>;
  metadata: Record<string, unknown>;
  heartbeat_interval_seconds: number;
  last_heartbeat_at: string;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  description: string | null;
  repository_url: string | null;
  settings: Record<string, unknown>;
  memory: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Playbook {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  description: string | null;
  outcome: string;
  lifecycle: 'standard' | 'continuous';
  definition: Record<string, unknown>;
  version: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProjectTimelineEntry {
  kind?: string;
  workflow_id: string;
  name: string;
  state: string;
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
  workflow_relations?: WorkflowRelations;
}

export interface WorkflowRelationRef {
  workflow_id: string;
  name?: string | null;
  state: string;
  playbook_id?: string | null;
  playbook_name?: string | null;
  created_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  is_terminal: boolean;
  link: string;
}

export interface WorkflowRelations {
  parent: WorkflowRelationRef | null;
  children: WorkflowRelationRef[];
  latest_child_workflow_id: string | null;
  child_status_counts: {
    total: number;
    active: number;
    completed: number;
    failed: number;
    cancelled: number;
  };
}

export interface ResolvedWorkflowConfig {
  workflow_id: string;
  resolved_config: Record<string, unknown>;
  config_layers?: Record<string, Record<string, unknown>>;
}

export interface ResolvedDocumentReference {
  logical_name: string;
  scope: 'project' | 'workflow';
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

export interface TaskArtifact {
  id: string;
  workflow_id?: string | null;
  project_id?: string | null;
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

export interface Workflow {
  id: string;
  tenant_id: string;
  project_id: string | null;
  playbook_id?: string | null;
  playbook_version?: number | null;
  name: string;
  state: string;
  lifecycle?: 'standard' | 'continuous' | null;
  parameters?: Record<string, unknown>;
  context: Record<string, unknown>;
  metadata: Record<string, unknown>;
  current_stage?: string | null;
  active_stages?: string[];
  work_item_summary?: {
    total_work_items: number;
    open_work_item_count: number;
    completed_work_item_count: number;
    active_stage_count: number;
    awaiting_gate_count: number;
      active_stage_names: string[];
  } | null;
  workflow_relations?: WorkflowRelations;
  workflow_stages?: WorkflowStage[];
  work_items?: WorkflowWorkItem[];
  activations?: WorkflowActivation[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface WorkflowStage {
  id: string;
  workflow_id: string;
  name: string;
  position: number;
  goal: string;
  guidance?: string | null;
  human_gate: boolean;
  status: string;
  gate_status: string;
  iteration_count: number;
  summary?: string | null;
  recommendation?: string | null;
  concerns?: string[];
  key_artifacts?: Array<Record<string, unknown>>;
  started_at?: string | null;
  completed_at?: string | null;
  updated_at?: string;
}

export interface WorkflowWorkItem {
  id: string;
  workflow_id: string;
  parent_work_item_id?: string | null;
  stage_name: string;
  title: string;
  goal?: string | null;
  acceptance_criteria?: string | null;
  column_id: string;
  owner_role?: string | null;
  priority: string;
  notes?: string | null;
  metadata?: Record<string, unknown>;
  task_count?: number;
  children_count?: number;
  is_milestone?: boolean;
  children?: WorkflowWorkItem[];
  completed_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ListWorkflowWorkItemsQuery {
  parent_work_item_id?: string;
  stage_name?: string;
  column_id?: string;
  grouped?: boolean;
}

export interface GetWorkflowWorkItemQuery {
  include_children?: boolean;
}

export interface WorkflowActivation {
  id: string;
  workflow_id: string;
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

export interface WorkflowBoardColumn {
  id: string;
  name: string;
  title: string;
  description?: string | null;
  color?: string | null;
  limit?: number | null;
  position: number;
  is_blocked?: boolean;
  is_terminal?: boolean;
}

export interface WorkflowBoard {
  columns: WorkflowBoardColumn[];
  work_items: WorkflowWorkItem[];
  stage_summary: Array<{
    name: string;
    goal: string;
    work_item_count: number;
    completed_count: number;
  }>;
}

export interface ApprovalTaskRecord {
  id: string;
  title: string;
  state: string;
  workflow_id?: string | null;
  workflow_name?: string | null;
  created_at: string;
  output?: unknown;
}

export interface ApprovalStageGateRecord {
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
  requested_at?: string;
  decided_at?: string | null;
  updated_at: string;
}

export interface ApprovalQueue {
  task_approvals: ApprovalTaskRecord[];
  stage_gates: ApprovalStageGateRecord[];
}

export interface TaskMemory {
  key?: string;
  value?: unknown;
  memory?: Record<string, unknown>;
}

export interface TaskArtifactCatalogEntry {
  id: string;
  task_id: string;
  workflow_id?: string | null;
  work_item_id?: string | null;
  project_id?: string | null;
  name: string;
  logical_path?: string | null;
  content_type: string;
  size_bytes: number;
  created_at: string;
  metadata: Record<string, unknown>;
  download_url: string;
}

export interface Task {
  id: string;
  tenant_id: string;
  workflow_id: string | null;
  project_id: string | null;
  parent_id: string | null;
  title: string;
  description: string | null;
  state: TaskState;
  priority: TaskPriority;
  capabilities_required: string[];
  role: string | null;
  role_config: Record<string, unknown>;
  environment: Record<string, unknown>;
  resource_bindings: unknown[];
  input: Record<string, unknown>;
  output: unknown;
  metadata: Record<string, unknown>;
  assigned_agent_id: string | null;
  assigned_worker_id: string | null;
  depends_on: string[];
  requires_approval: boolean;
  timeout_minutes: number;
  auto_retry: boolean;
  max_retries: number;
  retry_count: number;
  claimed_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlatformEvent {
  id: string;
  tenant_id: string;
  entity_type: string;
  entity_id: string;
  type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  priority?: TaskPriority;
  workflow_id?: string;
  project_id?: string;
  parent_id?: string;
  role?: string;
  input?: Record<string, unknown>;
  depends_on?: string[];
  requires_approval?: boolean;
  capabilities_required?: string[];
  role_config?: Record<string, unknown>;
  environment?: Record<string, unknown>;
  resource_bindings?: unknown[];
  timeout_minutes?: number;
  token_budget?: number;
  cost_cap_usd?: number;
  auto_retry?: boolean;
  max_retries?: number;
  metadata?: Record<string, unknown>;
}

export interface CreatePlaybookInput {
  name: string;
  slug?: string;
  description?: string;
  outcome: string;
  lifecycle?: 'standard' | 'continuous';
  definition: Record<string, unknown>;
}

export interface UpdatePlaybookInput {
  name?: string;
  slug?: string;
  description?: string;
  outcome?: string;
  lifecycle?: 'standard' | 'continuous';
  definition?: Record<string, unknown>;
}

export interface CreateWorkflowInput {
  playbook_id: string;
  name: string;
  project_id?: string;
  parameters?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  config_overrides?: Record<string, unknown>;
  instruction_config?: Record<string, unknown>;
}

export interface CreateWorkflowWorkItemInput {
  request_id?: string;
  parent_work_item_id?: string;
  stage_name?: string;
  title: string;
  goal?: string;
  acceptance_criteria?: string;
  column_id?: string;
  owner_role?: string;
  priority?: TaskPriority;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateWorkflowWorkItemInput {
  parent_work_item_id?: string | null;
  title?: string;
  goal?: string;
  acceptance_criteria?: string;
  stage_name?: string;
  column_id?: string;
  owner_role?: string | null;
  priority?: TaskPriority;
  notes?: string | null;
  metadata?: Record<string, unknown>;
}
