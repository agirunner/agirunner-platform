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
