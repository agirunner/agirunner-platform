import type { TaskPriority, TaskState } from './common.js';

export interface TaskArtifact {
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

export interface ApprovalTaskRecord {
  id: string;
  title: string;
  state: TaskState;
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
  workspace_id?: string | null;
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
  workspace_id: string | null;
  parent_id: string | null;
  title: string;
  description: string | null;
  state: TaskState;
  priority: TaskPriority;
  execution_backend: 'runtime_only' | 'runtime_plus_task';
  used_task_sandbox: boolean;
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
  workspace_id?: string;
  execution_backend?: 'runtime_only' | 'runtime_plus_task';
  parent_id?: string;
  role?: string;
  input?: Record<string, unknown>;
  depends_on?: string[];
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
