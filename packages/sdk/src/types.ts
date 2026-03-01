export type ApiScope = 'agent' | 'worker' | 'admin';

export type TaskType = 'analysis' | 'code' | 'review' | 'test' | 'docs' | 'orchestration' | 'custom';
export type TaskPriority = 'critical' | 'high' | 'normal' | 'low';
export type TaskState =
  | 'pending'
  | 'ready'
  | 'claimed'
  | 'running'
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

export interface Pipeline {
  id: string;
  tenant_id: string;
  project_id: string | null;
  template_id: string;
  name: string;
  state: string;
  input: Record<string, unknown>;
  context: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface Task {
  id: string;
  tenant_id: string;
  pipeline_id: string | null;
  project_id: string | null;
  parent_id: string | null;
  title: string;
  description: string | null;
  type: TaskType;
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
  type: TaskType;
  description?: string;
  priority?: TaskPriority;
  pipeline_id?: string;
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
