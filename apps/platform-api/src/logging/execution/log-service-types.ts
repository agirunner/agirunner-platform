export interface ExecutionLogEntry {
  tenantId: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string | null;
  source: 'runtime' | 'container_manager' | 'platform' | 'task_container';
  category:
    | 'llm'
    | 'tool'
    | 'agent_loop'
    | 'task_lifecycle'
    | 'runtime_lifecycle'
    | 'container'
    | 'api'
    | 'config'
    | 'auth';
  level: 'debug' | 'info' | 'warn' | 'error';
  operation: string;
  status: 'started' | 'completed' | 'failed' | 'skipped';
  durationMs?: number | null;
  payload?: Record<string, unknown>;
  error?: { code?: string; message: string; stack?: string } | null;
  workspaceId?: string | null;
  workflowId?: string | null;
  workflowName?: string | null;
  workspaceName?: string | null;
  taskId?: string | null;
  workItemId?: string | null;
  stageName?: string | null;
  activationId?: string | null;
  isOrchestratorTask?: boolean | null;
  executionBackend?: 'runtime_only' | 'runtime_plus_task' | null;
  toolOwner?: 'runtime' | 'task' | null;
  taskTitle?: string | null;
  role?: string | null;
  actorType?: string | null;
  actorId?: string | null;
  actorName?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  resourceName?: string | null;
  createdAt?: string | null;
}

export interface LogRow {
  id: string;
  tenant_id: string;
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  source: string;
  category: string;
  level: string;
  operation: string;
  status: string;
  duration_ms: number | null;
  payload: Record<string, unknown>;
  error: { code?: string; message: string; stack?: string } | null;
  workspace_id: string | null;
  workflow_id: string | null;
  workflow_name: string | null;
  workspace_name: string | null;
  task_id: string | null;
  work_item_id: string | null;
  stage_name: string | null;
  activation_id: string | null;
  is_orchestrator_task: boolean;
  execution_backend: 'runtime_only' | 'runtime_plus_task' | null;
  tool_owner: 'runtime' | 'task' | null;
  task_title: string | null;
  role: string | null;
  actor_type: string | null;
  actor_id: string | null;
  actor_name: string | null;
  resource_type: string | null;
  resource_id: string | null;
  resource_name: string | null;
  execution_environment_id: string | null;
  execution_environment_name: string | null;
  execution_environment_image: string | null;
  execution_environment_distro: string | null;
  execution_environment_package_manager: string | null;
  created_at: string;
  cursor_created_at?: string | null;
}

export interface LogFilters {
  workspaceId?: string;
  workflowId?: string;
  taskId?: string;
  workItemId?: string;
  stageName?: string;
  activationId?: string;
  isOrchestratorTask?: boolean;
  executionBackend?: string[];
  toolOwner?: string[];
  traceId?: string;
  source?: string[];
  category?: string[];
  level?: string;
  operation?: string[];
  status?: string[];
  role?: string[];
  actorKind?: string[];
  actorType?: string[];
  actorId?: string[];
  executionEnvironment?: string;
  search?: string;
  since?: string;
  until?: string;
  cursor?: string;
  perPage?: number;
  order?: 'asc' | 'desc';
}

export interface LogStatsFilters {
  workspaceId?: string;
  traceId?: string;
  workflowId?: string;
  taskId?: string;
  workItemId?: string;
  stageName?: string;
  activationId?: string;
  isOrchestratorTask?: boolean;
  executionBackend?: string[];
  toolOwner?: string[];
  source?: string[];
  category?: string[];
  level?: string;
  operation?: string[];
  status?: string[];
  role?: string[];
  actorKind?: string[];
  actorType?: string[];
  actorId?: string[];
  executionEnvironment?: string;
  search?: string;
  since?: string;
  until?: string;
  groupBy:
    | 'category'
    | 'operation'
    | 'level'
    | 'task_id'
    | 'work_item_id'
    | 'stage_name'
    | 'activation_id'
    | 'is_orchestrator_task'
    | 'source'
    | 'execution_backend'
    | 'tool_owner';
}

export interface LogStatsGroup {
  group: string;
  count: number;
  error_count: number;
  total_duration_ms: number;
  avg_duration_ms: number;
  agg: {
    total_input_tokens?: number;
    total_output_tokens?: number;
    total_cost_usd?: number;
  };
}

export interface LogStats {
  groups: LogStatsGroup[];
  totals: {
    count: number;
    error_count: number;
    total_duration_ms: number;
  };
}

export interface KeysetPage<T> {
  data: T[];
  pagination: {
    per_page: number;
    has_more: boolean;
    next_cursor: string | null;
    prev_cursor: string | null;
  };
}

export interface OperationCount {
  operation: string;
  count: number;
}

export interface OperationValue {
  operation: string;
}

export interface RoleValue {
  role: string;
}

export interface ActorKindValue {
  actor_kind: string;
}

export interface WorkflowValue {
  id: string;
  name: string | null;
  workspace_id: string | null;
}

export interface LogBatchRejectionDetail {
  index: number;
  trace_id: string;
  operation: string;
  reason: string;
}

export interface ActorInfo {
  actor_kind: string;
  actor_id: string | null;
  actor_name: string | null;
  count: number;
  latest_role?: string | null;
  latest_workflow_id?: string | null;
  latest_workflow_name?: string | null;
  latest_workflow_label?: string | null;
}

export interface LogLevelFilter {
  shouldWrite(tenantId: string, level: string): Promise<boolean>;
}
